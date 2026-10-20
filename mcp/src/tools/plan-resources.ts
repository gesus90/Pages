import { readTool, writeTool } from "./plans.js";

import type { Tool } from "@modelcontextprotocol/server";
import type {
  AgentPlanCommandOperation,
  AgentPlanReadOperation,
} from "../../../definition/AgentPlanOperations.js";

const IDENTIFIER = { type: "string", minLength: 1, maxLength: 100 } as const;
const TARGET = {
  planId: IDENTIFIER,
  expectedRevision: { type: "integer", minimum: 1 },
} as const;

/** Resource reads use current project/department access and never disclose another executor's run. */
export const PLAN_RESOURCE_READ_TOOLS: readonly {
  readonly operation: AgentPlanReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "plans.templates.list",
    tool: readTool({
      name: "list_plan_templates",
      title: "List plan templates",
      description:
        "Lists existing personal and project/department node, parameter, script and group templates. workspaceId resolves current project access. Templates are append-only: the editor has no update/delete operation. No execution occurs.",
      properties: { workspaceId: IDENTIFIER },
      required: ["workspaceId"],
    }),
  },
  {
    operation: "plans.templates.read",
    tool: readTool({
      name: "read_plan_template",
      title: "Read plan template",
      description:
        "Reads one currently visible template with its configuration and internal members, edges and bindings. Hidden IDs answer NOT_FOUND. Insert with update_plan changes.insertTemplate, which creates independent IDs and checks target access again.",
      properties: { workspaceId: IDENTIFIER, templateId: IDENTIFIER },
      required: ["workspaceId", "templateId"],
    }),
  },
  {
    operation: "plans.control.read",
    tool: readTool({
      name: "read_plan_control",
      title: "Read plan controls",
      description:
        "Reads current canPlay/canPause/canResume/canStop action availability, without private run IDs, results or errors. Recheck after a conflict. Direct scripts require active administrator mode, current resource rights and an executable configured profile.",
      properties: { planId: IDENTIFIER },
      required: ["planId"],
    }),
  },
];

/** Explicit saved-revision commands never run as a side effect of graph editing. */
export const PLAN_COMMAND_TOOLS: readonly {
  readonly operation: AgentPlanCommandOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "plans.templates.save",
    tool: writeTool({
      name: "save_plan_template",
      title: "Save plan node template",
      description:
        "Saves one node (including a group with internal connections) from the saved expectedRevision as a new template. Requires current edit and resource access. name is 1..120 characters, unique per creator ignoring case/space. Outer references stay behind. Returns templateId; does not change or execute the plan. Replaying identical operationId returns the original templateId.",
      properties: {
        ...TARGET,
        nodeId: IDENTIFIER,
        name: { type: "string", minLength: 1, maxLength: 120 },
      },
      optionalKeys: [],
      isDestructive: false,
    }),
  },
  ...(["delete", "play", "pause", "resume", "stop"] as const).map((action) => ({
    operation: `plans.${action}` as const,
    tool: writeTool({
      name: `${action}_plan`,
      title: `${action} plan`,
      description: `Explicit ${action} of the saved expectedRevision. ${action === "delete" ? "Owner only; active runs prevent deletion; finished history is retained." : "Requires canEdit and current access to every referenced resource. Play starts the saved graph only; pause/resume/stop also require runId of the connected executor and the same plan. Resume adopts the saved revision at its durable pause boundary. Play and Resume may invoke configured models and change workspaces under the saved run permissions. Direct scripts execute configured interpreters in the approved workspace and require active administrator mode; no model or agent session is used for scripts. Active scripts drain on Pause; Stop ends owned processes."} operationId is recorded atomically with the durable change. Identical replay returns the original acknowledgement after fresh access checks; different content or a stale revision is CONFLICT. No credential or client graph is accepted.`,
      properties: {
        ...TARGET,
        ...(action === "pause" || action === "resume" || action === "stop"
          ? { runId: IDENTIFIER }
          : {}),
      },
      optionalKeys: [],
      isDestructive: action !== "pause",
      isOpenWorld: action === "play" || action === "resume",
    }),
  })),
];
