import { data } from "react-router";
import { z } from "zod";

import { AgentDeletionError } from "@/backend/service/employee/AgentDeletionService";

import { invalidInput } from "./user-action-support.server";

import type {
  UsersActionData,
  UsersActionHandler,
  UsersActionResult,
  UsersIntent,
} from "./user-action-support.server";

const DELETE_SCHEMA = z.object({
  agentId: z.string().uuid(),
  previewId: z.string().uuid(),
  operationId: z.string().uuid(),
});

const RESTORE_SCHEMA = z.object({
  agentId: z.string().uuid(),
  operationId: z.string().uuid(),
});

function deletionFailure(
  error: unknown,
  intent: UsersIntent,
): UsersActionResult {
  if (!(error instanceof AgentDeletionError)) throw error;
  const status = {
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INVALID_REQUEST: 400,
  }[error.code];
  return data<UsersActionData>(
    {
      ok: false,
      intent,
      error: error.code === "CONFLICT" ? "conflict" : "invalidInput",
      ...(error.code === "FORBIDDEN"
        ? { code: "FORBIDDEN" as const, reason: error.reason }
        : {}),
    },
    { status },
  );
}

/** Confirms an agent deletion from the management preview dialog. */
export const handleDeleteAgent: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const input = DELETE_SCHEMA.safeParse(Object.fromEntries(formData));
  if (!input.success) return invalidInput("delete-agent");
  try {
    await services.agentDeletionService.delete(
      actor.id,
      input.data.agentId,
      input.data.previewId,
      input.data.operationId,
    );
    return data<UsersActionData>({
      ok: true,
      intent: "delete-agent",
      agentId: input.data.agentId,
    });
  } catch (error: unknown) {
    return deletionFailure(error, "delete-agent");
  }
};

/** Restores a deleted agent from the administrator's list. */
export const handleRestoreAgent: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const input = RESTORE_SCHEMA.safeParse(Object.fromEntries(formData));
  if (!input.success) return invalidInput("restore-agent");
  try {
    await services.agentDeletionService.restore(
      actor.id,
      input.data.agentId,
      input.data.operationId,
    );
    return data<UsersActionData>({ ok: true, intent: "restore-agent" });
  } catch (error: unknown) {
    return deletionFailure(error, "restore-agent");
  }
};
