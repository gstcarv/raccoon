import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
  isTerminal,
  isActive,
  toBoardStatus,
  STATE_TO_BOARD_STATUS,
  type RunState,
} from "@/domain/run/state-machine.js";
import { InvalidTransitionError } from "@/domain/errors/index.js";

const ALL_STATES: RunState[] = [
  "QUEUED",
  "PREPARING",
  "IMPLEMENTING",
  "VERIFYING",
  "PUBLISHING",
  "IN_REVIEW",
  "REVIEWING",
  "DONE",
  "FAILED",
  "CANCELLED",
  "RETRYING",
];

const VALID_PAIRS: [RunState, RunState][] = [
  ["QUEUED", "PREPARING"],
  ["QUEUED", "CANCELLED"],
  ["PREPARING", "IMPLEMENTING"],
  ["PREPARING", "FAILED"],
  ["PREPARING", "CANCELLED"],
  ["IMPLEMENTING", "VERIFYING"],
  ["IMPLEMENTING", "FAILED"],
  ["IMPLEMENTING", "CANCELLED"],
  ["VERIFYING", "PUBLISHING"],
  ["VERIFYING", "IMPLEMENTING"],
  ["VERIFYING", "FAILED"],
  ["VERIFYING", "CANCELLED"],
  ["PUBLISHING", "IN_REVIEW"],
  ["PUBLISHING", "FAILED"],
  ["PUBLISHING", "CANCELLED"],
  ["IN_REVIEW", "REVIEWING"],
  ["IN_REVIEW", "DONE"],
  ["IN_REVIEW", "FAILED"],
  ["IN_REVIEW", "CANCELLED"],
  ["REVIEWING", "DONE"],
  ["REVIEWING", "IMPLEMENTING"],
  ["REVIEWING", "FAILED"],
  ["REVIEWING", "CANCELLED"],
  ["FAILED", "RETRYING"],
  ["RETRYING", "PREPARING"],
  ["RETRYING", "FAILED"],
];

describe("assertValidTransition", () => {
  it.each(VALID_PAIRS)("allows %s → %s", (from, to) => {
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it("throws InvalidTransitionError on invalid transition", () => {
    expect(() => assertValidTransition("DONE", "QUEUED")).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertValidTransition("CANCELLED", "PREPARING")).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertValidTransition("QUEUED", "DONE")).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertValidTransition("IMPLEMENTING", "QUEUED")).toThrow(
      InvalidTransitionError,
    );
  });

  it("error message contains from and to states", () => {
    try {
      assertValidTransition("DONE", "QUEUED");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      if (e instanceof InvalidTransitionError) {
        expect(e.message).toContain("DONE");
        expect(e.message).toContain("QUEUED");
      }
    }
  });
});

describe("isTerminal", () => {
  it.each(["DONE", "FAILED", "CANCELLED"] as RunState[])(
    "%s is terminal",
    (state) => {
      expect(isTerminal(state)).toBe(true);
    },
  );

  it.each(
    ALL_STATES.filter((s) => !["DONE", "FAILED", "CANCELLED"].includes(s)),
  )("%s is not terminal", (state) => {
    expect(isTerminal(state)).toBe(false);
  });
});

describe("isActive", () => {
  it("is the inverse of isTerminal", () => {
    for (const state of ALL_STATES) {
      expect(isActive(state)).toBe(!isTerminal(state));
    }
  });
});

describe("toBoardStatus", () => {
  it("maps all states to a canonical board status", () => {
    for (const state of ALL_STATES) {
      const status = toBoardStatus(state);
      expect(["BACKLOG", "IN_PROGRESS", "IN_REVIEW", "DONE", "BLOCKED"]).toContain(status);
    }
  });

  it("maps active work states to IN_PROGRESS", () => {
    expect(toBoardStatus("PREPARING")).toBe("IN_PROGRESS");
    expect(toBoardStatus("IMPLEMENTING")).toBe("IN_PROGRESS");
    expect(toBoardStatus("VERIFYING")).toBe("IN_PROGRESS");
    expect(toBoardStatus("PUBLISHING")).toBe("IN_PROGRESS");
    expect(toBoardStatus("RETRYING")).toBe("IN_PROGRESS");
  });

  it("maps review states to IN_REVIEW", () => {
    expect(toBoardStatus("IN_REVIEW")).toBe("IN_REVIEW");
    expect(toBoardStatus("REVIEWING")).toBe("IN_REVIEW");
  });

  it("maps terminal states correctly", () => {
    expect(toBoardStatus("DONE")).toBe("DONE");
    expect(toBoardStatus("FAILED")).toBe("BLOCKED");
    expect(toBoardStatus("CANCELLED")).toBe("BLOCKED");
  });

  it("maps QUEUED to BACKLOG", () => {
    expect(toBoardStatus("QUEUED")).toBe("BACKLOG");
  });
});

describe("STATE_TO_BOARD_STATUS", () => {
  it("covers all states", () => {
    for (const state of ALL_STATES) {
      expect(STATE_TO_BOARD_STATUS[state]).toBeDefined();
    }
  });
});
