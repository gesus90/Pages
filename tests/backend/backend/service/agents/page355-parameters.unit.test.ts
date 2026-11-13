import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { bindAgentParameters } from "@/backend/service/agents/AgentParameterBinding";
import { AgentPlanPreparationFailures } from "@/backend/service/agents/AgentPlanPreparationFailures";
import { AgentPlanScriptPreparation } from "@/backend/service/agents/AgentPlanScriptPreparation";
import { scriptInputJson } from "@/backend/service/agents/AgentPlanScriptInputs";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { ADMIN } from "./agent-plan-service-harness";

import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  readSpawnScope: vi.fn(async () => ({})),
}));

const REFERENCES = {
  workspace: vi.fn(async () => ({ path: "/synthetic" })),
  wiki: vi.fn(async () => ({ markdown: "page", link: "/wiki", version: "1" })),
};

it("binds missing required text and ticket properties empty for plans while direct agent calls stay strict", async () => {
  const template = {
    ...emptyAgentConfiguration(),
    markdown:
      "{{text}}|{{ticket}}|{{ticket.description}}|{{ticket.assets}}|{{unknown}}",
    parameters: [
      {
        name: "text",
        type: "text" as const,
        description: "",
        isRequired: true,
        defaultValue: null,
      },
      {
        name: "ticket",
        type: "ticket" as const,
        description: "",
        isRequired: true,
        defaultValue: null,
      },
    ],
  };
  expect(
    (
      await bindAgentParameters(
        template,
        {},
        { ...REFERENCES, allowIncomplete: true },
      )
    ).markdown,
  ).toBe("||||");
  await expect(
    bindAgentParameters({ ...template, markdown: "{{text}}" }, {}, REFERENCES),
  ).rejects.toMatchObject({ code: "parameter_required" });
});

it("turns mismatched types and invalid numbers into null without resolving a resource", async () => {
  const bound = await bindAgentParameters(
    {
      ...emptyAgentConfiguration(),
      markdown: "{{input}}",
      parameters: [
        {
          name: "input",
          type: "text",
          description: "",
          isRequired: true,
          defaultValue: null,
        },
      ],
    },
    { input: { type: "number", number: Number.NaN } },
    { ...REFERENCES, allowIncomplete: true },
  );
  expect(bound.markdown).toBe("");
  expect(bound.values.input).toBeNull();
  expect(REFERENCES.workspace).not.toHaveBeenCalled();
});

const SCRIPT: AgentPlanScript = {
  id: "script",
  type: "script",
  name: "Process ticket",
  x: 0,
  y: 0,
  interpreterProfileId: "python",
  content: "print('result')",
  timeoutSeconds: 30,
  inputs: [
    { name: "ticket", type: "text", isRequired: true },
    { name: "missing", type: "text", isRequired: true },
  ],
  outputs: [{ name: "result", type: "text" }],
  bindings: { ticket: { kind: "source", nodeId: "absent" } },
};
const PLAN: AgentPlan = {
  id: "plan",
  name: "Plan",
  ownerId: "admin",
  workspaceId: "workspace",
  projectId: "project",
  usage: "private",
  revision: 1,
  globals: {},
  nodes: [SCRIPT],
  edges: [],
};

it("prepares required script inputs empty and sends every declared key to the script", async () => {
  const preparation = new AgentPlanScriptPreparation({
    scripts: {
      executable: async () => ({
        id: "python",
        name: "Python",
        path: "/synthetic/python",
      }),
    },
    workspaces: {
      resolve: async () => ({
        id: "workspace",
        path: "/synthetic",
        directoryIdentity: "synthetic",
        projectId: "project",
        revision: 1,
        github: null,
      }),
    },
    access: {
      require: async () => ({
        ...PLAN,
        canEdit: true,
        projectName: "Project",
        github: null,
      }),
    },
    authorization: {
      snapshot: async () => ({ accounts: [ADMIN], roles: [], departments: [] }),
    },
    tasks: { snapshot: vi.fn() },
  });
  const snapshots = await preparation.prepare("admin", PLAN, []);
  const script = snapshots[0];
  if (!script) throw new Error("No script snapshot");
  expect(script.inputs).toEqual({ ticket: "", missing: "" });
  const run: AgentPlanRun = {
    id: "run",
    planId: "plan",
    planName: "Plan",
    planRevision: 1,
    userId: "admin",
    status: "running",
    startedAt: "2026-11-13",
    stopRequested: false,
    steps: [],
  };
  expect(JSON.parse(scriptInputJson(run, script))).toEqual({
    ticket: "",
    missing: "",
  });
});

it.each([
  "plan_access_denied",
  "plan_script_permission_denied",
  "plan_script_approval_required",
] as const)("keeps %s as a hard authorization refusal", async (code) => {
  const failures = new AgentPlanPreparationFailures();
  await expect(
    failures.capture("node", async () => {
      throw new AgentError(code);
    }),
  ).rejects.toMatchObject({ code });
  expect(failures.snapshot()).toEqual({});
});
