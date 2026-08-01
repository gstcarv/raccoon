import { describe, expect, it } from "vitest";
import { newRunId, newEventId } from "@/shared/ids.js";

describe("ids", () => {
  it("newRunId generates unique UUIDs", () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("newEventId generates unique UUIDs", () => {
    const a = newEventId();
    const b = newEventId();
    expect(a).not.toBe(b);
  });
});
