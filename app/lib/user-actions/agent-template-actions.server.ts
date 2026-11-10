import { data } from "react-router";

import { logCaughtError } from "@/backend/logging/Logger";

import { toAgentError } from "./agent-employee-actions.server";
import { invalidInput } from "./user-action-support.server";

import type {
  UsersActionData,
  UsersActionHandler,
} from "./user-action-support.server";

/** Reads the template fields, which the dialog sends as one JSON field. */
function readTemplate(formData: FormData): unknown {
  const raw = formData.get("template");
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Stores a template of `AGENT.md` (PAGE-283): a new one without
 * `templateId`, otherwise the named one. The service checks the right to
 * manage agents and every field.
 */
export const handleSaveAgentTemplate: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const template = readTemplate(formData);
  const templateId = formData.get("templateId");
  if (template === null) return invalidInput("save-agent-template");
  try {
    if (typeof templateId === "string" && templateId !== "")
      await services.agentTemplateService.update(
        actor.id,
        templateId,
        template,
      );
    else await services.agentTemplateService.create(actor.id, template);
  } catch (error: unknown) {
    logCaughtError("agent_template_actions", error);
    return toAgentError(error, "save-agent-template");
  }
  return data<UsersActionData>({ intent: "save-agent-template", ok: true });
};

/** Removes a template of `AGENT.md` (PAGE-283); no agent changes with it. */
export const handleDeleteAgentTemplate: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  try {
    await services.agentTemplateService.remove(
      actor.id,
      formData.get("templateId"),
    );
  } catch (error: unknown) {
    logCaughtError("agent_template_actions", error);
    return toAgentError(error, "delete-agent-template");
  }
  return data<UsersActionData>({ intent: "delete-agent-template", ok: true });
};
