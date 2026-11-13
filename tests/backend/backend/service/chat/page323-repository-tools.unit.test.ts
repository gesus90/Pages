import { expect, it, vi } from "vitest";

import { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import { registerPicaRepositoryTools } from "@/backend/service/chat/PicaRepositoryTools";
import { RepositoryReadError } from "@/definition/RepositoryRead";

import type { RepositoryReadService } from "@/backend/service/github/RepositoryReadService";

it("lists and dispatches repository reads for an ordinary account and preserves a denied result", async () => {
  const run = vi.fn<RepositoryReadService["run"]>(async () => ({
    commits: [],
  }));
  const registry = new RuntimeToolRegistry(async () => false);
  registerPicaRepositoryTools(registry, {
    service: { run },
    spend: () => true,
  });
  const context = {
    userId: "Ed",
    sessionId: "session",
    runId: "run",
    signal: new AbortController().signal,
    authorize: vi.fn(async () => undefined),
  };
  expect(
    registry.describe({ includeAdministrator: false }).map((tool) => tool.id),
  ).toEqual([
    "repository_log",
    "repository_diff",
    "repository_show",
    "repository_file",
  ]);
  expect(
    await registry.invoke(
      "repository_log",
      { projectId: "pages", range: "c5ee1978..3468b2db" },
      context,
    ),
  ).toMatchObject({ isValid: true, output: { ok: true } });
  expect(run).toHaveBeenCalledWith("Ed", "repository_log", {
    projectId: "pages",
    range: "c5ee1978..3468b2db",
    page: 1,
    limit: 30,
  });
  run.mockRejectedValueOnce(new RepositoryReadError("FORBIDDEN"));
  expect(
    await registry.invoke("repository_log", { projectId: "private" }, context),
  ).toMatchObject({ output: { ok: false, error: "FORBIDDEN", result: null } });
  expect(context.authorize).toHaveBeenCalled();
});
