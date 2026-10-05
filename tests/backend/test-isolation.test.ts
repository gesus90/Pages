import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDatabasePath } from "@/backend/database/DatabasePath";

describe("test isolation", () => {
  it("runs every suite with a throwaway home directory", () => {
    expect(path.dirname(homedir())).toBe(tmpdir());
    expect(path.basename(homedir())).toMatch(/^pages-test-home-/u);
  });

  it("keeps the default database of a suite inside that home directory", () => {
    expect(resolveDatabasePath().startsWith(homedir())).toBe(true);
  });
});
