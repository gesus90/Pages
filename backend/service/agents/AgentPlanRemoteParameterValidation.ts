import { scanAgentPlaceholders } from "@/definition/AgentParameters";
import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { MAX_RUNNER_PROMPT_CHARACTERS } from "@/definition/RunnerExecution";
import { PLAN_HANDOVER_LIMITS } from "@/definition/AgentPlanHandover";

import { bindAgentParameters } from "./AgentParameterBinding";
import { assetFailure } from "./AgentPlanStepFailure";
import type {
  RemotePlanParameters,
  RemoteParameterAsset,
} from "./AgentPlanRemoteParameters";
import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentReferenceResolvers } from "./AgentParameterBinding";

/** Returns the same safe node/parameter cause for editor checks and dispatch failures. */
export function remoteParameterError(
  nodeId: string,
  port: string,
  type: string,
  error: unknown,
): AgentPlanValidationError {
  let reason: AgentPlanIssue["reason"] = "remoteParameter";
  if (type === "ticket") reason = "remoteTicketUnavailable";
  if (type === "wiki") reason = "remoteWikiUnavailable";
  if (type === "workspace") reason = "remoteWorkspaceParameter";
  if (error instanceof AgentError) {
    if (error.code === "parameter_assets_too_large")
      reason = "remoteAssetsTooLarge";
    else if (
      error.code === "parameter_asset_type_unsupported" ||
      error.code === "parameter_asset_reference_unsupported"
    )
      reason = "remoteAssetType";
    else if (
      error.code === "parameter_asset_unavailable" ||
      error.code === "parameter_ticket_changed"
    )
      reason = "remoteAssetUnavailable";
  }
  return new AgentPlanValidationError([
    {
      nodeId,
      port,
      reason,
      ...(assetFailure(error).assetFailure
        ? { asset: assetFailure(error).assetFailure }
        : {}),
    },
  ]);
}

/** Binds frozen remote content through the existing non-recursive parameter binder. */
export function remoteParameterResolvers(
  prepared: RemotePlanParameters,
): AgentReferenceResolvers {
  return {
    allowIncomplete: true,
    ticket: (id) => {
      const ticket = prepared.tickets[id];
      return ticket
        ? Promise.resolve(ticket)
        : Promise.reject(new AgentError("parameter_ticket_unavailable"));
    },
    wiki: (id) => {
      const page = prepared.wiki[id];
      return page
        ? Promise.resolve(page)
        : Promise.reject(new AgentError("parameter_reference_unavailable"));
    },
    workspace: (id) => {
      const workspace = prepared.workspaces[id];
      return workspace
        ? Promise.resolve({ path: workspace.path })
        : Promise.reject(new AgentError("parameter_reference_unavailable"));
    },
  };
}

/** Checks the complete template with the same typed values later used at dispatch. */
export async function validateRemoteParameterPrompt(
  step: AgentPlanStep,
  prepared: RemotePlanParameters,
  markdown: string,
): Promise<void> {
  const template = step.configuration?.template;
  if (!template) throw new AgentError("configuration_invalid");
  try {
    const bound = await bindAgentParameters(
      { ...template, markdown },
      prepared.values,
      remoteParameterResolvers(prepared),
    );
    requireRemotePromptSize(
      step,
      bound.markdown + remoteWorkspaceContext(prepared),
    );
  } catch (error: unknown) {
    if (error instanceof AgentPlanValidationError) throw error;
    const port =
      template.parameters.find(
        (parameter) => parameter.isRequired && !prepared.values[parameter.name],
      )?.name ??
      template.parameters[0]?.name ??
      "parameters";
    throw remoteParameterError(step.id, port, "", error);
  }
}

/** Adds only the pinned names and paths of remote workspace parameters. */
export function remoteWorkspaceContext(
  prepared: RemotePlanParameters | undefined,
): string {
  if (!prepared?.resources.some((resource) => resource.type === "workspace"))
    return "";
  return `\n\nPages remote workspaces:\n${Object.values(prepared.workspaces)
    .map((workspace) => `${workspace.workspaceName}: ${workspace.path}`)
    .join("\n")}`;
}

/** Refuses an oversized complete prompt with its node and contributing parameter names, without truncating it. */
export function requireRemotePromptSize(
  step: AgentPlanStep,
  prompt: string,
): void {
  if (prompt.length <= MAX_RUNNER_PROMPT_CHARACTERS) return;
  const template = step.configuration?.template;
  const names = scanAgentPlaceholders(
    `${template?.markdown ?? ""}\n\n${step.instruction}`,
  ).placeholders.map((placeholder) => placeholder.name);
  const ports =
    template?.parameters
      .filter((parameter) => names.includes(parameter.name))
      .map((parameter) => parameter.name) ?? [];
  throw new AgentPlanValidationError(
    (ports.length ? ports : [null]).map((port) => ({
      nodeId: step.id,
      port,
      reason: "remotePromptTooLarge",
    })),
  );
}

/** Refuses an asset handover beyond the pinned file, byte and manifest limits. */
export function requireAssetBudget(
  assets: readonly RemoteParameterAsset[],
): void {
  const originalBytes = assets.reduce(
    (total, asset) => total + asset.file.size,
    0,
  );
  const manifestBytes =
    Buffer.byteLength(JSON.stringify(assets.map((asset) => asset.file))) +
    assets.reduce((total, asset) => total + (asset.file.modelSize ?? 0), 0);
  if (
    assets.length <= PLAN_HANDOVER_LIMITS.files &&
    originalBytes <= PLAN_HANDOVER_LIMITS.bytes &&
    manifestBytes <= 1024 * 1024
  )
    return;
  const last = assets.at(-1);
  if (last)
    throw new AgentAssetError(
      "parameter_assets_too_large",
      last.reference,
      last.file.name,
    );
  throw new AgentError("parameter_assets_too_large");
}
