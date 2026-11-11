import { approvePermission, refusePermission } from "./AcpPermissions";

import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { AcpSessionProfile, AcpSessionPurpose } from "./AcpDriver";

/** The managed OpenCode agent whose only tools come from the Pica bridge. */
export const OPENCODE_PICA_MODE = "pages-pica";

/** The managed OpenCode agent of a decision model, which may use no tool at all (PAGE-286). */
export const OPENCODE_DECISION_MODE = "pages-decision";

/** Rules of a decision session: every tool is denied. */
export const OPENCODE_DECISION_PERMISSIONS: Readonly<Record<string, string>> = {
  "*": "deny",
};

/** Native primary agent IDs; the persisted Pages modes remain read_only and yolo. */
export const OPENCODE_PLAN_MODES = {
  read_only: "pages-read-only",
  yolo: "pages-yolo",
} as const;

// The names of OpenCode's own tools. The native Pages build offers none of them; naming them keeps them denied should it ever list one.
const OPENCODE_BUILT_IN_TOOLS = [
  "bash",
  "edit",
  "write",
  "patch",
  "read",
  "glob",
  "grep",
  "list",
  "webfetch",
  "websearch",
  "codesearch",
  "task",
  "todowrite",
  "todoread",
  "skill",
  "lsp",
] as const;

/**
 * Rules of Pica's OpenCode session: the native Pages tools carry the names of
 * the Pica catalog, so they are allowed by default and every tool of OpenCode
 * itself is denied.
 */
export const OPENCODE_PICA_PERMISSIONS: Readonly<Record<string, string>> = {
  "*": "allow",
  ...Object.fromEntries(OPENCODE_BUILT_IN_TOOLS.map((name) => [name, "deny"])),
};

/** Native rules, including explicit secret-file denials that full tool access does not override. */
export function openCodePlanPermissions(
  mode: AcpPermissionMode,
): Readonly<Record<string, unknown>> {
  const read = { "*": "allow", "*.env": "deny", "*.env.*": "deny" };
  if (mode === "yolo") return { "*": "allow", read };
  return {
    "*": "deny",
    read,
    list: "allow",
    glob: "allow",
    grep: "allow",
    webfetch: "allow",
    websearch: "allow",
    "pages_*": "allow",
  };
}

function planProfile(mode: AcpPermissionMode): AcpSessionProfile {
  const sessionMode = OPENCODE_PLAN_MODES[mode];
  return {
    mode,
    unattended:
      "Native OpenCode ACP; managed permission rules and automatic ACP decisions, no interactive approvals",
    permissions: {
      permissionMode: mode,
      sessionMode,
      tools:
        mode === "yolo"
          ? "all available native tools and authorized Pages MCP tools"
          : "native reading tools and read-only Pages MCP tools",
      files: mode === "yolo" ? "workspace write" : "read only",
      shell: mode === "yolo" ? "on" : "off",
      web: "on",
      settings: "Pages managed only",
      mcpServers: "Pages only",
      permissionRules: JSON.stringify(openCodePlanPermissions(mode)),
    },
    reportedOptions: {
      sessionMode: "mode",
      model: "model",
      reasoningEffort: "effort",
    },
    matchesReportedModel: null,
    hasMcpStatusCommand: false,
    isContinuable: true,
    steps: (request) => [
      {
        id: "mode",
        value: sessionMode,
        refusal: "plan_permission_mode_unenforceable",
      },
      { id: "model", value: request.model, refusal: "plan_model_unavailable" },
      {
        id: "effort",
        value: request.reasoningEffort ?? "default",
        refusal: "plan_reasoning_unsupported",
        isOptional: request.reasoningEffort === null,
      },
    ],
    decide: (request) => {
      if (mode === "read_only") return refusePermission(request);
      const decision = approvePermission(request);
      return { ...decision, isDenied: decision.outcome.outcome !== "selected" };
    },
  };
}

/**
 * The conversation of an agent employee with full access: the YOLO rules of a
 * plan node with every native tool inside the bubblewrap isolation, on the
 * stock runner instead of the native Pages build, and the Pages tools of the
 * agent's account over Pica's turn-bound bridge.
 */
function chatFullAccessProfile(): AcpSessionProfile {
  const yolo = planProfile("yolo");
  return {
    ...yolo,
    unattended:
      "Native OpenCode ACP for an agent employee with full access, inside the bubblewrap isolation; managed permission rules and automatic ACP decisions, no interactive approvals",
    permissions: {
      ...yolo.permissions,
      tools:
        "all available native tools and the Pages tools of the agent's account",
      pagesTools: "Pica bridge with the rights of the agent's account",
      mcpServers: "Pica bridge only",
    },
  };
}

/**
 * The profile of one Pages mode.
 *
 * @param mode - "Nur Lesen" or "YOLO", as the agent stores it.
 * @param purpose - A Pica conversation takes the chat profile; the caller
 * decides beforehand which stored mode it accepts for it. Only an agent
 * employee with full access reaches the chat purpose in YOLO. A decision
 * model and the group observer (PAGE-296) take the profile without any
 * tool, whatever the mode.
 * @returns The plan profile of the mode, Pica's narrower read-only profile, or
 * the full access profile of an employee's conversation.
 */
export function openCodeAcpProfile(
  mode: AcpPermissionMode,
  purpose?: AcpSessionPurpose,
): AcpSessionProfile {
  if (purpose === "decision" || purpose === "observer")
    return OPENCODE_DECISION_PROFILE;
  if (purpose !== "chat") return planProfile(mode);
  return mode === "yolo" ? chatFullAccessProfile() : OPENCODE_PICA_PROFILE;
}

/**
 * Pica's OpenCode profile. It runs only the verified native Pages build, whose
 * tool registry offers nothing but the Pages catalog; each call is authorized
 * again by Pages for the person, the conversation and the running turn.
 */
export const OPENCODE_PICA_PROFILE: AcpSessionProfile = {
  mode: "read_only",
  unattended:
    "Native Pages build of OpenCode with only the authorized Pica tools; every other tool is denied",
  permissions: {
    permissionMode: "read_only",
    sessionMode: OPENCODE_PICA_MODE,
    tools: "Pages catalog only, through the native Pages build",
    files: "none",
    shell: "off",
    web: "off",
    settings: "Pages managed only",
    mcpServers: "none",
  },
  reportedOptions: {
    sessionMode: "mode",
    model: "model",
    reasoningEffort: "effort",
  },
  matchesReportedModel: null,
  hasMcpStatusCommand: false,
  isContinuable: true,
  steps: (request) => [
    {
      id: "mode",
      value: OPENCODE_PICA_MODE,
      refusal: "plan_permission_mode_unenforceable",
    },
    { id: "model", value: request.model, refusal: "plan_model_unavailable" },
    {
      id: "effort",
      value: request.reasoningEffort ?? "default",
      refusal: "plan_reasoning_unsupported",
      isOptional: request.reasoningEffort === null,
    },
  ],
  decide: refusePermission,
};

/**
 * The OpenCode profile of a decision model (PAGE-286): one prompt, one JSON
 * answer, every tool denied and no MCP server. A correction of an invalid
 * answer continues the same session once.
 */
export const OPENCODE_DECISION_PROFILE: AcpSessionProfile = {
  mode: "read_only",
  unattended:
    "Native OpenCode ACP for a decision model; every tool is denied, no interactive approvals",
  permissions: {
    permissionMode: "read_only",
    sessionMode: OPENCODE_DECISION_MODE,
    tools: "none",
    files: "none",
    shell: "off",
    web: "off",
    settings: "Pages managed only",
    mcpServers: "none",
    permissionRules: JSON.stringify(OPENCODE_DECISION_PERMISSIONS),
  },
  reportedOptions: {
    sessionMode: "mode",
    model: "model",
    reasoningEffort: "effort",
  },
  matchesReportedModel: null,
  hasMcpStatusCommand: false,
  isContinuable: true,
  steps: (request) => [
    {
      id: "mode",
      value: OPENCODE_DECISION_MODE,
      refusal: "plan_permission_mode_unenforceable",
    },
    { id: "model", value: request.model, refusal: "plan_model_unavailable" },
    {
      id: "effort",
      value: request.reasoningEffort ?? "default",
      refusal: "plan_reasoning_unsupported",
      isOptional: request.reasoningEffort === null,
    },
  ],
  decide: refusePermission,
};
