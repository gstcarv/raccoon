export type ErrorCode =
  | "INVALID_TRANSITION"
  | "PROVIDER_ERROR"
  | "AGENT_EXECUTION_ERROR"
  | "CONFIGURATION_ERROR"
  | "DOMAIN_ERROR";

export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly isRetryable: boolean;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidTransitionError extends DomainError {
  readonly code = "INVALID_TRANSITION" as const;
  readonly isRetryable = false;

  constructor(from: string, to: string) {
    super(`Invalid state transition: ${from} → ${to}`);
  }
}

export class ProviderError extends DomainError {
  readonly code = "PROVIDER_ERROR" as const;

  constructor(
    message: string,
    readonly isRetryable: boolean,
  ) {
    super(message);
  }
}

export class AgentExecutionError extends DomainError {
  readonly code = "AGENT_EXECUTION_ERROR" as const;

  constructor(
    message: string,
    readonly isRetryable: boolean,
  ) {
    super(message);
  }
}

export class ConfigurationError extends DomainError {
  readonly code = "CONFIGURATION_ERROR" as const;
  readonly isRetryable = false;
}
