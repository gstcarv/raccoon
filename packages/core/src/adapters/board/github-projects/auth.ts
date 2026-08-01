import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import type { Env } from "@/config/schema.js";

interface InstallationToken {
  token: string;
  expiresAt: number; // ms epoch
}

function makeJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const sig = createSign("SHA256")
    .update(data)
    .sign({ key: privateKey, padding: 1 /* RSA_PKCS1_PADDING */ })
    .toString("base64url");
  return `${data}.${sig}`;
}

export class GitHubAuth {
  private cachedInstallationToken: InstallationToken | null = null;

  constructor(private readonly env: Env) {}

  async getToken(): Promise<string> {
    if (this.env.GITHUB_TOKEN) return this.env.GITHUB_TOKEN;
    if (
      this.env.GITHUB_APP_ID &&
      this.env.GITHUB_APP_PRIVATE_KEY &&
      this.env.GITHUB_APP_INSTALLATION_ID
    ) {
      return this.getInstallationToken(
        this.env.GITHUB_APP_ID,
        this.env.GITHUB_APP_PRIVATE_KEY,
        this.env.GITHUB_APP_INSTALLATION_ID,
      );
    }
    throw new Error("No GitHub auth configured: set GITHUB_TOKEN or GitHub App credentials");
  }

  private async getInstallationToken(
    appId: string,
    privateKey: string,
    installationId: string,
  ): Promise<string> {
    const now = Date.now();
    if (this.cachedInstallationToken && this.cachedInstallationToken.expiresAt > now + 5 * 60_000) {
      return this.cachedInstallationToken.token;
    }

    const jwt = makeJwt(appId, privateKey);
    const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to get installation token: ${String(res.status)} ${await res.text()}`);
    }

    const data = (await res.json()) as { token: string; expires_at: string };
    this.cachedInstallationToken = {
      token: data.token,
      expiresAt: new Date(data.expires_at).getTime(),
    };
    return data.token;
  }

  verifyHmac(secret: string, rawBody: Buffer, signature: string): boolean {
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
