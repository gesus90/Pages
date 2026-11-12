import { data } from "react-router";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";
import { readAgentEmployeeInput } from "@/backend/service/employee/AgentEmployeeInput";

import { parseAvatarUpload } from "../settings-actions/avatar-upload.server";
import { invalidInput } from "./user-action-support.server";

import type { AgentEmployeeErrorCode } from "@/backend/error/AgentEmployeeError";
import type { AgentAvatarUpload } from "@/backend/service/employee/AgentEmployeeAdministration";
import type { AgentEmployeeInput } from "@/backend/service/employee/AgentEmployeeInput";
import type {
  UsersActionData,
  UsersActionHandler,
  UsersActionResult,
  UsersErrorCode,
  UsersIntent,
} from "./user-action-support.server";

const AGENT_ERRORS: Readonly<
  Record<AgentEmployeeErrorCode, { code: UsersErrorCode; status: number }>
> = {
  forbidden: { code: "forbidden", status: 403 },
  invalidInput: { code: "invalidInput", status: 400 },
  notFound: { code: "userNotFound", status: 404 },
  conflict: { code: "conflict", status: 409 },
  usernameTaken: { code: "usernameTaken", status: 409 },
  modelNotAllowed: { code: "modelNotAllowed", status: 400 },
  accessUnsupported: { code: "accessUnsupported", status: 400 },
  accessAdminRequired: { code: "accessAdminRequired", status: 403 },
  isolationUnavailable: { code: "isolationUnavailable", status: 409 },
  templateNameTaken: { code: "templateNameTaken", status: 409 },
  inactive: { code: "invalidInput", status: 400 },
  busy: { code: "invalidInput", status: 409 },
  unavailable: { code: "invalidInput", status: 400 },
  stopped: { code: "invalidInput", status: 409 },
};

/**
 * Turns a refused agent operation into the response the panel shows.
 *
 * @param error - What the service rejected with; anything else is thrown again.
 * @param intent - The intent of the form.
 */
export function toAgentError(
  error: unknown,
  intent: UsersIntent,
): UsersActionResult {
  if (!(error instanceof AgentEmployeeError)) throw error;
  const failure = AGENT_ERRORS[error.code];
  return data<UsersActionData>(
    { ok: false, intent, error: failure.code },
    { status: failure.status },
  );
}

/** Reads the agent fields, which the panel sends as one JSON field. */
function readInput(formData: FormData): AgentEmployeeInput | null {
  const raw = formData.get("agent");
  if (typeof raw !== "string") return null;
  try {
    return readAgentEmployeeInput(JSON.parse(raw));
  } catch (error: unknown) {
    if (error instanceof SyntaxError || error instanceof AgentEmployeeError)
      return null;
    throw error;
  }
}

/** Reads an uploaded avatar image; `undefined` for an invalid one. */
async function readAvatar(
  formData: FormData,
): Promise<AgentAvatarUpload | null | undefined> {
  const upload = await parseAvatarUpload(formData.get("avatar"));
  if (upload.status === "missing") return null;
  return upload.status === "ready" ? upload.avatar : undefined;
}

/** Creates an agent in the user administration (PAGE-266). */
export const handleCreateAgent: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const input = readInput(formData);
  const avatar = await readAvatar(formData);
  if (!input || avatar === undefined) return invalidInput("create-agent");
  try {
    await services.agentEmployeeAdministration.create(actor.id, input, avatar);
  } catch (error: unknown) {
    logCaughtError("agent_employee_actions", error);
    return toAgentError(error, "create-agent");
  }
  return data<UsersActionData>({ intent: "create-agent", ok: true });
};

/** Saves the panel of an agent (PAGE-266). */
export const handleUpdateAgent: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const input = readInput(formData);
  const avatar = await readAvatar(formData);
  const agentId = formData.get("agentId");
  const revision = Number(formData.get("revision"));
  if (
    !input ||
    avatar === undefined ||
    typeof agentId !== "string" ||
    !Number.isSafeInteger(revision)
  )
    return invalidInput("update-agent");
  try {
    await services.agentEmployeeAdministration.update(
      actor.id,
      agentId,
      { input, revision },
      avatar,
    );
  } catch (error: unknown) {
    logCaughtError("agent_employee_actions", error);
    return toAgentError(error, "update-agent");
  }
  return data<UsersActionData>({ intent: "update-agent", ok: true });
};

/** Restores a version of an agent's memory (PAGE-266). */
export const handleRestoreAgentMemory: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const agentId = formData.get("agentId");
  const versionId = formData.get("versionId");
  if (typeof agentId !== "string" || typeof versionId !== "string")
    return invalidInput("restore-agent-memory");
  try {
    await services.agentEmployeeAdministration.restoreMemory(
      actor.id,
      agentId,
      { id: versionId, expectedRevision: null },
    );
  } catch (error: unknown) {
    logCaughtError("agent_employee_actions", error);
    return toAgentError(error, "restore-agent-memory");
  }
  return data<UsersActionData>({ intent: "restore-agent-memory", ok: true });
};

/** Empties `MEMORY.md` or `DREAM.md` of an agent; the version before stays restorable (PAGE-305). */
export const handleResetAgentMemory: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const agentId = formData.get("agentId");
  const file = formData.get("file");
  if (typeof agentId !== "string" || (file !== "memory" && file !== "dream"))
    return invalidInput("reset-agent-memory");
  try {
    await services.agentEmployeeAdministration.resetMemory(
      actor.id,
      agentId,
      file,
    );
  } catch (error: unknown) {
    logCaughtError("agent_employee_actions", error);
    return toAgentError(error, "reset-agent-memory");
  }
  return data<UsersActionData>({ intent: "reset-agent-memory", ok: true });
};

/** Sets the person color of another account (PAGE-266). */
export const handleSetUserColor: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const userId = formData.get("userId");
  if (typeof userId !== "string") return invalidInput("set-user-color");
  try {
    await services.personColorService.set(
      actor.id,
      userId,
      formData.get("color"),
    );
  } catch (error: unknown) {
    logCaughtError("agent_employee_actions", error);
    return toAgentError(error, "set-user-color");
  }
  return data<UsersActionData>({ intent: "set-user-color", ok: true });
};
