import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDefaultConfigPath } from "@/backend/config/PagesConfig";

describe("test isolation", () => {
  it("runs every suite with a throwaway home directory", () => {
    expect(path.dirname(homedir())).toBe(tmpdir());
    expect(path.basename(homedir())).toMatch(/^pages-test-home-/u);
  });

  it("keeps the default configuration of a suite inside that home directory", () => {
    expect(resolveDefaultConfigPath().startsWith(homedir())).toBe(true);
  });
});
