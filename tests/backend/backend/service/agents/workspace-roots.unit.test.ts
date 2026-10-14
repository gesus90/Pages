import { homedir } from "node:os";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { resolveWorkspaceRoots } from "@/app/lib/agent-workspace-services.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("needs no variable: every directory qualifies and the browser opens at the home directory", () => {
  vi.stubEnv("PAGES_WORKSPACE_ROOTS", "");

  expect(resolveWorkspaceRoots()).toEqual({
    roots: [path.parse(homedir()).root],
    startDirectory: homedir(),
  });
});

it("narrows to the roots an operator names and ignores empty entries", () => {
  vi.stubEnv(
    "PAGES_WORKSPACE_ROOTS",
    ["/srv/projects", " ", "/opt/work"].join(path.delimiter),
  );

  expect(resolveWorkspaceRoots()).toEqual({
    roots: ["/srv/projects", "/opt/work"],
  });
});
