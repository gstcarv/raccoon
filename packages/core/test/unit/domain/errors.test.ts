import { describe, expect, it } from "vitest";
import {
  InvalidTransitionError,
  ProviderError,
  AgentExecutionError,
  ConfigurationError,
} from "@/domain/errors/index.js";

describe("DomainError hierarchy", () => {
  it("InvalidTransitionError has correct code and is not retryable", () => {
    const e = new InvalidTransitionError("QUEUED", "DONE");
    expect(e.code).toBe("INVALID_TRANSITION");
    expect(e.isRetryable).toBe(false);
    expect(e.message).toContain("QUEUED");
    expect(e.message).toContain("DONE");
    expect(e).toBeInstanceOf(Error);
  });

  it("ProviderError propagates retryable flag", () => {
    const retryable = new ProviderError("rate limit", true);
    expect(retryable.code).toBe("PROVIDER_ERROR");
    expect(retryable.isRetryable).toBe(true);

    const fatal = new ProviderError("not found", false);
    expect(fatal.isRetryable).toBe(false);
  });

  it("AgentExecutionError propagates retryable flag", () => {
    const e = new AgentExecutionError("timeout", true);
    expect(e.code).toBe("AGENT_EXECUTION_ERROR");
    expect(e.isRetryable).toBe(true);
  });

  it("ConfigurationError is not retryable", () => {
    const e = new ConfigurationError("missing env");
    expect(e.code).toBe("CONFIGURATION_ERROR");
    expect(e.isRetryable).toBe(false);
  });
});
