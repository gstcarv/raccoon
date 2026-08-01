import { graphql } from "@octokit/graphql";
import type {
  BoardProvider,
  BoardEvent,
  RawWebhookRequest,
} from "@/ports/board-provider.js";
import type { BoardItemRef, CanonicalBoardStatus, Task } from "@/domain/task/index.js";
import type { Env } from "@/config/schema.js";
import { GitHubAuth } from "./auth.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldOption {
  id: string;
  name: string;
}

interface ProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: FieldOption[];
}

interface FieldCache {
  statusFieldId: string;
  optionsByName: Map<string, string>;
  optionsById: Map<string, string>;
  expiresAt: number;
}

interface GhItemContent {
  number: number;
  title: string;
  body: string;
  url: string;
  labels?: { nodes?: { name: string }[] };
  repository: { owner: { login: string }; name: string };
}

interface GhWebhookPayload {
  action?: string;
  projects_v2_item?: {
    id?: number;
    node_id?: string;
    project_node_id?: string;
    content_node_id?: string;
    content_type?: string;
    changes?: {
      field_value?: {
        field_node_id?: string;
        field_type?: string;
      };
    };
  };
  sender?: { login?: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIELD_CACHE_TTL_MS = 10 * 60_000;

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    }
  }
  throw lastError;
}

// ── GitHubProjectsBoardProvider ───────────────────────────────────────────────

export class GitHubProjectsBoardProvider implements BoardProvider {
  readonly id = "github-projects";

  private readonly auth: GitHubAuth;
  private fieldCache: FieldCache | null = null;

  constructor(private readonly env: Env) {
    this.auth = new GitHubAuth(env);
  }

  verifyWebhook(req: RawWebhookRequest): Promise<boolean> {
    const secret = this.env.GITHUB_WEBHOOK_SECRET;
    const sig = req.headers["x-hub-signature-256"];
    if (!sig || Array.isArray(sig)) return Promise.resolve(false);
    return Promise.resolve(this.auth.verifyHmac(secret, req.rawBody, sig));
  }

  parseEvent(req: RawWebhookRequest): Promise<BoardEvent | null> {
    return Promise.resolve(this.parseEventSync(req));
  }

  private parseEventSync(req: RawWebhookRequest): BoardEvent | null {
    const event = req.headers["x-github-event"];
    const deliveryId = req.headers["x-github-delivery"];

    if (!event || !deliveryId || Array.isArray(event) || Array.isArray(deliveryId)) return null;
    if (event !== "projects_v2_item") return null;

    let body: GhWebhookPayload;
    try {
      body = JSON.parse(req.rawBody.toString()) as GhWebhookPayload;
    } catch {
      return null;
    }

    const item = body.projects_v2_item;
    if (!item?.node_id || !item.project_node_id) return null;

    const taskRef: BoardItemRef = {
      provider: this.id,
      projectId: item.project_node_id,
      itemId: item.node_id,
    };

    if (body.action === "created") {
      return { kind: "TASK_CREATED", deliveryId, taskRef };
    }
    if (body.action === "edited" && item.changes?.field_value) {
      return { kind: "TASK_MOVED", deliveryId, taskRef };
    }

    return null;
  }

  async fetchTask(ref: BoardItemRef): Promise<Task> {
    const token = await this.auth.getToken();
    const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

    const result = await withRetry(() =>
      gql<{ node: { content: GhItemContent | null } }>(
        `query FetchItem($nodeId: ID!) {
          node(id: $nodeId) {
            ... on ProjectV2Item {
              content {
                ... on Issue {
                  number title body url
                  labels(first: 10) { nodes { name } }
                  repository { owner { login } name }
                }
                ... on PullRequest {
                  number title body url
                  repository { owner { login } name }
                }
              }
            }
          }
        }`,
        { nodeId: ref.itemId },
      ),
    );

    const content = result.node.content;
    if (!content) throw new Error(`No content for project item: ${ref.itemId}`);

    const { repository } = content;
    return {
      id: ref.itemId,
      boardRef: ref,
      repoRef: { owner: repository.owner.login, repo: repository.name },
      title: content.title,
      description: content.body,
      priority: "medium",
      labels: (content.labels?.nodes ?? []).map((l) => l.name),
      metadata: { url: content.url, number: content.number },
    };
  }

  async moveTask(ref: BoardItemRef, status: CanonicalBoardStatus): Promise<void> {
    const cache = await this.getFieldCache(ref.projectId);
    const optionId = cache.optionsByName.get(status);
    if (!optionId) return;

    const token = await this.auth.getToken();
    const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

    await withRetry(() =>
      gql(
        `mutation MoveItem($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
          }) { projectV2Item { id } }
        }`,
        { projectId: ref.projectId, itemId: ref.itemId, fieldId: cache.statusFieldId, optionId },
      ),
    );
  }

  async comment(ref: BoardItemRef, body: string): Promise<void> {
    const token = await this.auth.getToken();
    const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

    // subjectId = project item node_id; GitHub accepts this for addComment
    await withRetry(() =>
      gql(
        `mutation AddComment($subjectId: ID!, $body: String!) {
          addComment(input: { subjectId: $subjectId, body: $body }) { clientMutationId }
        }`,
        { subjectId: ref.itemId, body },
      ),
    );
  }

  // ── Field cache ─────────────────────────────────────────────────────────────

  private async getFieldCache(projectId: string): Promise<FieldCache> {
    if (this.fieldCache && this.fieldCache.expiresAt > Date.now()) {
      return this.fieldCache;
    }

    const token = await this.auth.getToken();
    const gql = graphql.defaults({ headers: { authorization: `token ${token}` } });
    const fieldName = this.env.GITHUB_STATUS_FIELD_NAME;

    const result = await withRetry(() =>
      gql<{ node: { fields: { nodes: ProjectField[] } } }>(
        `query ProjectFields($nodeId: ID!) {
          node(id: $nodeId) {
            ... on ProjectV2 {
              fields(first: 30) {
                nodes {
                  ... on ProjectV2SingleSelectField {
                    id name dataType
                    options { id name }
                  }
                }
              }
            }
          }
        }`,
        { nodeId: projectId },
      ),
    );

    const fields = result.node.fields.nodes;
    const statusField = fields.find(
      (f) => f.dataType === "SINGLE_SELECT" && f.name === fieldName,
    );

    if (!statusField?.options) {
      throw new Error(
        `GitHub Projects field "${fieldName}" not found or is not a single-select field`,
      );
    }

    const optionsByName = new Map<string, string>();
    const optionsById = new Map<string, string>();
    for (const opt of statusField.options) {
      optionsByName.set(opt.name, opt.id);
      optionsById.set(opt.id, opt.name);
    }

    this.fieldCache = {
      statusFieldId: statusField.id,
      optionsByName,
      optionsById,
      expiresAt: Date.now() + FIELD_CACHE_TTL_MS,
    };

    return this.fieldCache;
  }
}
