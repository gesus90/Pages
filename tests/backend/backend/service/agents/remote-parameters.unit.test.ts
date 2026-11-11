import { describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  AgentPlanRemoteParameters,
  remoteParameterError,
  remoteParameterResolvers,
  remoteWorkspaceContext,
  requireRemotePromptSize,
  validateRemoteParameterPrompt,
} from "@/backend/service/agents/AgentPlanRemoteParameters";
import { MAX_RUNNER_PROMPT_CHARACTERS } from "@/definition/RunnerExecution";

import { partial } from "../../../app/lib/service-wiring-fakes";
import { remoteTodoParameters, remoteTodoStep } from "./page162-remote-fixture";

import type { AgentPlan } from "@/definition/AgentPlan";
import type { AgentPlanRemoteTarget } from "@/definition/AgentPlanExecution";
import type { AgentParameter } from "@/definition/AgentParameters";

const target: AgentPlanRemoteTarget = {
  kind: "remote",
  connectionId: "connection",
  connectionRevision: 1,
  connectionName: "Host",
  workspaceId: "workspace",
  workspaceRevision: 1,
  workspaceName: "Workspace",
  path: "/work",
};

function world(): {
  service: AgentPlanRemoteParameters;
  resolve: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
} {
  const resolve = vi.fn(async () => remoteTodoParameters().tickets.ticket);
  const list = vi.fn(async () => [target]);
  const service = new AgentPlanRemoteParameters({
    tickets: partial({ resolve }),
    content: partial({}),
    assets: partial({}),
    authorization: partial({}),
    users: partial({}),
    targets: partial({ list }),
  });
  return { service, resolve, list };
}

function stepWith(
  parameters: AgentParameter[],
): ReturnType<typeof remoteTodoStep> {
  const step = remoteTodoStep();
  if (!step.configuration) throw new Error("Missing fixture configuration");
  return {
    ...step,
    configuration: {
      ...step.configuration,
      template: {
        ...step.configuration.template,
        parameters,
      },
    },
  };
}

describe("remote parameter preparation", () => {
  it("pins ticket and workspace references and rechecks their access", async () => {
    const { service, resolve, list } = world();
    const step = stepWith([
      {
        name: "ticket",
        type: "ticket",
        description: "",
        isRequired: true,
        defaultValue: { type: "ticket", ticketId: "ticket" },
      },
      {
        name: "workspace",
        type: "workspace",
        description: "",
        isRequired: true,
        defaultValue: { type: "workspace", workspaceId: "workspace" },
      },
    ]);
    const prepared = await service.prepare("user", {
      plan: partial<AgentPlan>({ projectId: "project" }),
      step,
      tasks: [],
      target,
    });
    expect(prepared.tickets.ticket?.title).toBe("Synthetic work");
    expect(prepared.resources).toEqual([
      expect.objectContaining({
        parameter: "ticket",
        type: "ticket",
        id: "ticket",
      }),
      {
        parameter: "workspace",
        type: "workspace",
        id: "workspace",
        name: "Workspace",
        version: "1",
      },
    ]);
    expect(remoteWorkspaceContext(prepared)).toBe(
      "\n\nPages remote workspaces:\nWorkspace: /work",
    );
    await service.authorize("user", prepared, { projectId: "project", target });
    expect(resolve).toHaveBeenCalledTimes(2);
    list.mockResolvedValueOnce([{ ...target, workspaceRevision: 2 }]);
    await expect(
      service.authorize("user", prepared, { projectId: "project", target }),
    ).rejects.toMatchObject({ code: "plan_context_changed" });
  });

  it("reports unavailable workspace against its parameter", async () => {
    const { service, list } = world();
    list.mockResolvedValueOnce([]);
    const step = stepWith([
      {
        name: "workspace",
        type: "workspace",
        description: "",
        isRequired: true,
        defaultValue: { type: "workspace", workspaceId: "missing" },
      },
    ]);
    await expect(
      service.prepare("user", {
        plan: partial<AgentPlan>({ projectId: "project" }),
        step,
        tasks: [],
        target,
      }),
    ).rejects.toMatchObject({
      issues: [
        {
          nodeId: "agent",
          port: "workspace",
          reason: "remoteWorkspaceParameter",
        },
      ],
    });
  });
});

describe("remote parameter diagnostics", () => {
  it.each([
    ["ticket", new Error("private"), "remoteTicketUnavailable"],
    ["wiki", new Error("private"), "remoteWikiUnavailable"],
    [
      "other",
      new AgentError("parameter_assets_too_large"),
      "remoteAssetsTooLarge",
    ],
    [
      "ticket",
      new AgentError("parameter_asset_type_unsupported"),
      "remoteAssetType",
    ],
    [
      "wiki",
      new AgentError("parameter_ticket_changed"),
      "remoteAssetUnavailable",
    ],
  ])("maps %s failures to safe diagnostics", (type, error, reason) => {
    expect(remoteParameterError("node", "input", type, error).issues).toEqual([
      { nodeId: "node", port: "input", reason },
    ]);
  });

  it("resolves only pinned references", async () => {
    const resolvers = remoteParameterResolvers(remoteTodoParameters());
    await expect(resolvers.ticket?.("ticket")).resolves.toMatchObject({
      id: "ticket",
    });
    await expect(resolvers.ticket?.("missing")).rejects.toMatchObject({
      code: "parameter_ticket_unavailable",
    });
    await expect(resolvers.wiki("missing")).rejects.toMatchObject({
      code: "parameter_reference_unavailable",
    });
    await expect(resolvers.workspace("missing")).rejects.toMatchObject({
      code: "parameter_reference_unavailable",
    });
    expect(remoteWorkspaceContext(undefined)).toBe("");
  });

  it("accepts bounded prompts and reports oversized prompts", async () => {
    const step = remoteTodoStep();
    const prepared = { ...remoteTodoParameters(), values: {} };
    await expect(
      validateRemoteParameterPrompt(step, prepared, "hello"),
    ).resolves.toBeUndefined();
    expect(() =>
      requireRemotePromptSize(step, "x".repeat(MAX_RUNNER_PROMPT_CHARACTERS)),
    ).not.toThrow();
    expect(() =>
      requireRemotePromptSize(
        step,
        "x".repeat(MAX_RUNNER_PROMPT_CHARACTERS + 1),
      ),
    ).toThrowError(
      expect.objectContaining({
        issues: [
          { nodeId: "agent", port: null, reason: "remotePromptTooLarge" },
        ],
      }),
    );
  });
});
