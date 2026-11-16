import { expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  remoteParameterError,
  remoteParameterResolvers,
  remoteWorkspaceContext,
  requireAssetBudget,
  requireRemotePromptSize,
} from "@/backend/service/agents/AgentPlanRemoteParameterValidation";
import { MAX_RUNNER_PROMPT_CHARACTERS } from "@/definition/RunnerExecution";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  RemotePlanParameters,
  RemoteParameterAsset,
} from "@/backend/service/agents/AgentPlanRemoteParameters";
import type { AgentPlanStep } from "@/definition/AgentPlan";

it("maps inaccessible parameter types and asset failures to node-specific diagnostics", () => {
  expect(
    remoteParameterError("node", "ticket", "ticket", new Error()).issues,
  ).toMatchObject([
    { nodeId: "node", port: "ticket", reason: "remoteTicketUnavailable" },
  ]);
  expect(
    remoteParameterError("node", "wiki", "wiki", new Error()).issues,
  ).toMatchObject([{ reason: "remoteWikiUnavailable" }]);
  expect(
    remoteParameterError(
      "node",
      "files",
      "ticket",
      new AgentError("parameter_assets_too_large"),
    ).issues,
  ).toMatchObject([{ reason: "remoteAssetsTooLarge" }]);
});

it("resolves only pinned references and includes remote workspace names", async () => {
  const prepared = partial<RemotePlanParameters>({
    tickets: { one: { id: "one" } },
    wiki: {},
    workspaces: { work: { workspaceName: "Work", path: "/work" } },
    resources: [{ type: "workspace" }],
  });
  const resolvers = remoteParameterResolvers(prepared);
  if (!resolvers.ticket) throw new Error("Expected ticket resolver");
  await expect(resolvers.ticket("one")).resolves.toMatchObject({ id: "one" });
  await expect(resolvers.ticket("missing")).rejects.toMatchObject({
    code: "parameter_ticket_unavailable",
  });
  await expect(resolvers.wiki("missing")).rejects.toMatchObject({
    code: "parameter_reference_unavailable",
  });
  await expect(resolvers.workspace("work")).resolves.toEqual({ path: "/work" });
  expect(remoteWorkspaceContext(prepared)).toContain("Work: /work");
  expect(remoteWorkspaceContext(undefined)).toBe("");
});

it("refuses oversized prompts and asset manifests without truncating", () => {
  const step = partial<AgentPlanStep>({
    id: "step",
    instruction: "",
    configuration: { template: { markdown: "", parameters: [] } },
  });
  expect(() =>
    requireRemotePromptSize(step, "a".repeat(MAX_RUNNER_PROMPT_CHARACTERS)),
  ).not.toThrow();
  expect(() =>
    requireRemotePromptSize(step, "a".repeat(MAX_RUNNER_PROMPT_CHARACTERS + 1)),
  ).toThrow();
  expect(() => requireAssetBudget([])).not.toThrow();
  const file = partial<RemoteParameterAsset>({
    reference: { id: "file" },
    file: { name: "file", size: Number.MAX_SAFE_INTEGER },
  });
  expect(() => requireAssetBudget([file])).toThrow();
});
