import { bindAgentParameters } from "@/backend/service/agents/AgentParameterBinding";
import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import {
  acpRunOptions,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";

import type { AgentPlan, AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentParameterService } from "@/backend/service/agents/AgentParameterService";

/** Explicit account and isolated workspace of the practical proof; no credentials are serialized. */
export interface GroupProofOptions {
  readonly credentialData: string;
  readonly connectionId: string;
  readonly workspace: string;
  readonly model: string;
  readonly effort: string;
  readonly output: string;
}

/** Creates transient test definitions and a real prepared Start → Group → End snapshot. */
export async function prepareGroupProof(options: GroupProofOptions): Promise<{
  readonly plan: AgentPlan;
  readonly snapshot: AgentPlanSnapshot;
  readonly start: AgentPlanStepStart;
}> {
  const configuration = {
    ...emptyAgentConfiguration(),
    markdown:
      "Shared text parameter: {{shared}}. Use no tools and change no files or tickets.",
    parameters: [
      {
        name: "shared",
        type: "text" as const,
        description: "Shared proof value",
        isRequired: true,
        defaultValue: null,
      },
    ],
    run: acpRunOptions("read_only", 2),
  };
  const source: AgentDefinitionChoice = {
    id: "proof-agent",
    name: "Minimal Codex proof agent",
    purposes: ["agent"],
    model: options.model,
    reasoningEffort: options.effort,
    provider: "codex_cli",
    revision: 1,
    configuration,
    availability: { isUsable: true, reason: null, personalChoices: [] },
  };
  const assignment: ResolvedAgentAssignment = {
    model: options.model,
    reasoningEffort: options.effort,
    connection: {
      id: options.connectionId,
      name: "Practical proof account",
      provider: "codex_cli",
      isActive: true,
      hasApiKey: false,
      testModel: null,
      reasoningEffort: options.effort,
      cliLoggedInAt: new Date().toISOString(),
      cliAccountLabel: null,
      updatedAt: new Date().toISOString(),
    },
  };
  const profile: AgentProfile = {
    id: source.id,
    name: source.name,
    purposes: ["agent"],
    targets: [],
    isActive: true,
    connectionId: options.connectionId,
    model: options.model,
    reasoningEffort: options.effort,
    configuration,
  };
  const plan: AgentPlan = {
    ...proofGraph(source),
    id: "page73-practical-proof",
    ownerId: "proof",
    projectId: "proof-project",
    revision: 1,
  };
  const parameters = proofParameters(options);
  const profiles = {
    catalog: async () => [source],
    resolveDefinition: async () => ({
      assignment,
      profile,
      accessAgentId: source.id,
    }),
  };
  const tasks = {
    snapshot: async (): Promise<never> => {
      throw new Error("Practical proof has no ticket inputs");
    },
  };
  const preparation = new AgentPlanPreparation({ profiles, parameters, tasks });
  const start = new AgentPlanStepStart({
    profiles,
    parameters,
    tasks,
    access: {
      require: async () => ({
        ...plan,
        canEdit: true,
        projectName: "Transient practical proof",
        github: null,
      }),
    },
  });
  return { plan, snapshot: await preparation.prepare("proof", plan), start };
}

function proofGraph(source: AgentDefinitionChoice): AgentPlanInput {
  const instructions = [
    "Step one only: invent a new random 20-character lowercase hexadecimal nonce. Keep it in this conversation. Output exactly FIRST:<nonce>|shared=page73-common in your answer before the required report. This FIRST instruction ends with this step.",
    "Step two only: recall the nonce from the previous completed step in this conversation, reverse its character order and output SECOND:<reversed nonce>|shared=page73-common before the required report. Do not generate another nonce. Do not output a FIRST line. Use this step's instruction, not the previous step's output format.",
  ];
  return {
    name: "PAGE-73 practical shared-session proof",
    workspaceId: "proof-workspace",
    projectId: "proof-project",
    usage: "private",
    globals: {},
    nodes: [
      { id: "start", type: "start", x: 0, y: 0 },
      {
        id: "group",
        type: "group",
        name: "Two minimal Codex agents",
        x: 320,
        y: 0,
        steps: instructions.map((instruction, index) => ({
          id: `agent-${index + 1}`,
          type: "agent",
          x: 0,
          y: index * 320,
          agentId: source.id,
          personalAgentId: null,
          instruction,
          configuration: copyPlanConfiguration(source),
          bindings: { shared: { kind: "source", nodeId: "shared-interface" } },
        })),
        parameters: [
          {
            id: "shared-interface",
            name: "shared",
            type: "text",
            description: "Common external text",
            isRequired: true,
            defaultValue: null,
          },
        ],
        bindings: { shared: { kind: "source", nodeId: "external-text" } },
      },
      { id: "end", type: "end", x: 640, y: 0 },
      {
        id: "external-text",
        type: "parameter",
        name: "shared",
        format: "string",
        value: { type: "text", text: "page73-common" },
        x: 0,
        y: 320,
      },
    ],
    edges: [
      { from: "start", to: "group", fromPort: "flow-out", toPort: "flow-in" },
      { from: "group", to: "end", fromPort: "flow-out", toPort: "flow-in" },
    ],
  };
}

function proofParameters(
  options: GroupProofOptions,
): Pick<AgentParameterService, "prepare"> {
  return {
    prepare: async (userId, selection, values, override) => {
      const template = override ?? selection.configuration?.template;
      if (!template) throw new Error("Proof template missing");
      const parameters = await bindAgentParameters(template, values, {
        workspace: async (): Promise<never> => {
          throw new Error("No workspace parameter");
        },
        wiki: async (): Promise<never> => {
          throw new Error("No wiki parameter");
        },
        ticket: async (): Promise<never> => {
          throw new Error("No ticket parameter");
        },
      });
      return {
        parameters,
        workspace: {
          id: "proof-workspace",
          projectId: "proof-project",
          path: options.workspace,
          directoryIdentity: options.workspace,
          revision: 1,
          github: null,
        },
        directory: null,
        references: [],
        wiki: {},
        tickets: {},
      };
    },
  };
}
