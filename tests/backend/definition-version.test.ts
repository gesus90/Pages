import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { PAGES_VERSION } from "@/definition/Version";

describe("PAGES_VERSION", () => {
  it("is the version of package.json, the only place that names it", async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );

    expect(manifest).toMatchObject({ version: PAGES_VERSION });
    expect(PAGES_VERSION).toMatch(/^\d+\.\d+\.\d+/u);
  });
});
