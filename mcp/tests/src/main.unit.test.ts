import { describe, expect, it, vi } from "vitest";

import { start } from "../../src/start.ts";

vi.mock("../../src/start.ts", () => ({ start: vi.fn(async () => undefined) }));

describe("main", () => {
  it("starts the adapter once when the bundle is loaded", async () => {
    await import("../../src/main.ts");
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith();
  });
});
