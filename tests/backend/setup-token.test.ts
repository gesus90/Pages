import { describe, expect, it } from "vitest";

import { SetupToken } from "@/backend/runtime/SetupToken";

describe("SetupToken", () => {
  it("creates long random tokens", () => {
    const first = SetupToken.create();
    const second = SetupToken.create();

    expect(first.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.value).not.toBe(second.value);
  });

  it("only matches its own value", () => {
    const token = SetupToken.create();

    expect(token.matches(token.value)).toBe(true);
    expect(token.matches(`${token.value}x`)).toBe(false);
    expect(token.matches(token.value.slice(1))).toBe(false);
    expect(token.matches("")).toBe(false);
    expect(token.matches(null)).toBe(false);
    expect(token.matches(42)).toBe(false);
  });
});
