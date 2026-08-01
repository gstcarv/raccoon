import { describe, expect, it } from "vitest";
import { ok, err } from "@/shared/result.js";

describe("Result", () => {
  it("ok wraps a value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err wraps an error", () => {
    const r = err(new Error("boom"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("boom");
  });
});
