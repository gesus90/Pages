import { AgentError } from "@/backend/error/AgentErrors";

import { approvePermission, refusePermission } from "./AcpPermissions";

import type { AcpPermissionMode } from "@/definition/AgentConfiguration";
import type { AcpSessionProfile, AcpSessionPurpose } from "./AcpDriver";

/** The managed OpenCode agent whose only tools come from the Pica bridge. */
export const OPENCODE_PICA_MODE = "pages-pica";

/** Native primary agent IDs; the persisted Pages modes remain read_only and yolo. */
export const OPENCODE_PLAN_MODES = {
  read_only: "pages-read-only",
  yolo: "pages-yolo",
} as const;

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

/** Resolves a plan mode while preserving Pica's narrower, existing read-only profile. */
export function openCodeAcpProfile(
  mode: AcpPermissionMode,
  purpose?: AcpSessionPurpose,
): AcpSessionProfile {
  if (purpose !== "chat") return planProfile(mode);
  if (mode !== "read_only") throw new AgentError("opencode_chat_mode_required");
  return OPENCODE_PICA_PROFILE;
}

/**
 * Pica's native OpenCode profile: no shell, files, delegation or unmanaged MCP.
 * The process configuration denies every tool except `pages_*`, which the
 * bridge checks per call. Unexpected permission requests are refused.
 */
export const OPENCODE_PICA_PROFILE: AcpSessionProfile = {
  mode: "read_only",
  unattended:
    "Native OpenCode ACP with only the authorized Pica tool bridge; every other tool is denied",
  permissions: {
    permissionMode: "read_only",
    sessionMode: OPENCODE_PICA_MODE,
    tools: "Pica tool bridge only",
    files: "none",
    shell: "off",
    web: "off",
    settings: "Pages managed only",
    mcpServers: "Pica tool bridge only",
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
