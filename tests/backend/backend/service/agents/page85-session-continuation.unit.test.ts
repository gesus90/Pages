import { expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  decideContinuation,
  readContinuationCapabilities,
  reconstructedContext,
} from "@/backend/service/agents/sessions/AgentSessionContinuation";
import {
  checkSessionWorkspace,
  readWorkspaceGit,
} from "@/backend/service/agents/sessions/AgentSessionWorkspace";

import type { WorkspaceFiles } from "@/backend/service/agents/sessions/AgentSessionWorkspace";
import type { ContinuationFacts } from "@/backend/service/agents/sessions/AgentSessionContinuation";

const AT = "2026-10-17T01:00:00.000Z";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** Directories and files by path; a link maps a path to its real target. */
function files(
  tree: Readonly<Record<string, string | null>>,
  links: Readonly<Record<string, string>> = {},
): WorkspaceFiles {
  return {
    realpath: async (target) => {
      const real = links[target] ?? target;
      if (!(real in tree)) throw new Error("ENOENT");
      return real;
    },
    isDirectory: async (target) => {
      if (!(target in tree)) return null;
      return tree[target] === null;
    },
    readStart: async (target) => {
      const content = tree[target];
      if (typeof content !== "string") throw new Error("EISDIR");
      return content;
    },
  };
}

const FACTS: ContinuationFacts = {
  isAuthorized: true,
  isConfigurationCompatible: true,
  isProcessAlive: false,
  acpSessionId: "acp-1",
  capabilities: { canLoad: false, canResume: false },
  canUseCapabilities: true,
  canReconstruct: false,
  hasPlanCheckpoint: false,
};

it("reads branch, detached HEAD, a worktree pointer and a missing repository from files only", async () => {
  const branch = files({
    "/repo": null,
    "/repo/src": null,
    "/repo/.git": null,
    "/repo/.git/HEAD": "ref: refs/heads/task/PAGE-85\n",
  });
  expect(await readWorkspaceGit("/repo/src", branch)).toEqual({
    state: "branch",
    branch: "task/PAGE-85",
  });
  const detached = files({
    "/repo": null,
    "/repo/.git": null,
    "/repo/.git/HEAD": `${COMMIT}\n`,
  });
  expect(await readWorkspaceGit("/repo", detached)).toEqual({
    state: "detached",
    commit: COMMIT,
  });
  const worktree = files({
    "/work": null,
    "/work/.git": "gitdir: ../main/.git/worktrees/work\n",
    "/main/.git/worktrees/work/HEAD": "ref: refs/heads/feature\n",
  });
  expect(await readWorkspaceGit("/work", worktree)).toEqual({
    state: "branch",
    branch: "feature",
  });
  expect(await readWorkspaceGit("/plain", files({ "/plain": null }))).toEqual({
    state: "no_repository",
  });
  const broken = files({
    "/repo": null,
    "/repo/.git": null,
    "/repo/.git/HEAD": "garbage",
  });
  expect(await readWorkspaceGit("/repo", broken)).toEqual({
    state: "unreadable",
  });
});

it("refuses directories outside the assigned workspace, also through a link", async () => {
  const tree = files(
    {
      "/workspace": null,
      "/workspace/app": null,
      "/elsewhere": null,
    },
    { "/workspace/escape": "/elsewhere" },
  );
  const inside = await checkSessionWorkspace(
    { directory: "/workspace/app", workspace: "/workspace" },
    AT,
    tree,
  );
  expect(inside).toEqual({
    directory: "/workspace/app",
    git: { state: "no_repository" },
    checkedAt: AT,
  });
  for (const directory of [
    "/elsewhere",
    "/workspace/escape",
    "/workspace/gone",
  ]) {
    const result = await checkSessionWorkspace(
      { directory, workspace: "/workspace" },
      AT,
      tree,
    ).then(
      () => "accepted",
      (error: unknown) =>
        error instanceof AgentError ? error.code : "unexpected",
    );
    expect(result).toBe("workspace_path_invalid");
  }
});

it("reports live, resume, load, reconstruction and unavailability truthfully", () => {
  expect(decideContinuation({ ...FACTS, isProcessAlive: true }).mode).toBe(
    "live",
  );
  expect(
    decideContinuation({
      ...FACTS,
      capabilities: { canLoad: true, canResume: true },
    }).mode,
  ).toBe("resume");
  expect(
    decideContinuation({
      ...FACTS,
      capabilities: { canLoad: true, canResume: false },
    }).mode,
  ).toBe("load");
  // A capability Pages has no path for is named, never offered.
  expect(
    decideContinuation({
      ...FACTS,
      capabilities: { canLoad: true, canResume: true },
      canUseCapabilities: false,
    }),
  ).toMatchObject({ mode: "unavailable", reason: "pages_resume_unavailable" });
  // Without a confirmed capability no load or resume is attempted.
  expect(decideContinuation({ ...FACTS, capabilities: null })).toEqual({
    mode: "unavailable",
    reason: "native_session_ended",
    hasPlanCheckpoint: false,
  });
  expect(
    decideContinuation({
      ...FACTS,
      canReconstruct: true,
      hasPlanCheckpoint: true,
    }),
  ).toEqual({
    mode: "reconstructed",
    reason: "native_session_ended",
    hasPlanCheckpoint: true,
  });
  expect(
    decideContinuation({
      ...FACTS,
      isProcessAlive: true,
      isConfigurationCompatible: false,
    }),
  ).toMatchObject({
    mode: "unavailable",
    reason: "configuration_incompatible",
  });
  expect(
    decideContinuation({ ...FACTS, isProcessAlive: true, isAuthorized: false }),
  ).toMatchObject({ mode: "unavailable", reason: "access_denied" });
});

it("reads only confirmed adapter capabilities and bounds a reconstructed context", () => {
  expect(readContinuationCapabilities(undefined)).toEqual({
    canLoad: false,
    canResume: false,
  });
  expect(
    readContinuationCapabilities({
      loadSession: true,
      sessionCapabilities: { resume: {} },
    }),
  ).toEqual({ canLoad: true, canResume: true });
  expect(
    readContinuationCapabilities({ sessionCapabilities: { resume: null } })
      .canResume,
  ).toBe(false);
  const history = Array.from(
    { length: 10 },
    (_, index) => `entry ${index + 1}`,
  );
  const context = reconstructedContext(history, 230);
  const lines = context.split("\n");
  expect(lines[0]?.startsWith("Pages started a new session.")).toBe(true);
  expect(lines.at(-1)).toBe("entry 10");
  expect(lines).not.toContain("entry 1");
  expect(context).toContain("earlier entries omitted]");
  expect(context.length).toBeLessThanOrEqual(230);
  expect(reconstructedContext(["only"], 1_000).split("\n")).toHaveLength(2);
});
