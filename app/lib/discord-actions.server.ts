import { readRequiredText } from "@/app/lib/form-fields.server";
import { DiscordError } from "@/backend/error/DiscordErrors";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import type { ApplicationServices } from "@/app/lib/services.server";
import type {
  DiscordActionErrorCode,
  DiscordActionResult,
  DiscordEventSelection,
} from "@/definition/Discord";
import type { User } from "@/definition/User";

/** Everything a Discord panel action needs from the request. */
export interface DiscordActionContext {
  readonly actor: User;
  readonly formData: FormData;
  readonly projectId: string;
  readonly requestOrigin: string;
  readonly services: Pick<ApplicationServices, "discordConnectionService">;
}

type DiscordActionHandler = (
  context: DiscordActionContext,
) => Promise<DiscordActionResult>;

const ERROR_STATUS: Readonly<Record<DiscordActionErrorCode, number>> = {
  attempt_invalid: 409,
  channel_unavailable: 409,
  discord_unavailable: 502,
  forbidden: 403,
  invalid_events: 400,
  invalid_input: 400,
  not_configured: 409,
  not_connected: 409,
  not_found: 404,
  request_failed: 500,
};

function invalidInput(): DiscordActionResult {
  return { error: "invalid_input", ok: false };
}

function readEvents(formData: FormData): DiscordEventSelection {
  return {
    "milestone.created": formData.get("milestone.created") === "on",
    "milestone.updated": formData.get("milestone.updated") === "on",
    "ticket.created": formData.get("ticket.created") === "on",
    "ticket.updated": formData.get("ticket.updated") === "on",
  };
}

const handleStart: DiscordActionHandler = async ({
  actor,
  projectId,
  requestOrigin,
  services,
}) => ({
  ok: true,
  state: await services.discordConnectionService.startConnection(actor, {
    projectId,
    requestOrigin,
  }),
  test: null,
});

const handleConfirm: DiscordActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  const attemptId = readRequiredText(formData, "attemptId");
  const channelId = readRequiredText(formData, "channelId");

  if (attemptId === null || channelId === null) {
    return invalidInput();
  }

  return {
    ok: true,
    state: await services.discordConnectionService.confirmConnection(
      actor,
      projectId,
      { attemptId, channelId },
    ),
    test: null,
  };
};

const handleChannel: DiscordActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  const channelId = readRequiredText(formData, "channelId");

  if (channelId === null) {
    return invalidInput();
  }

  return {
    ok: true,
    state: await services.discordConnectionService.changeChannel(
      actor,
      projectId,
      channelId,
    ),
    test: null,
  };
};

const handleEvents: DiscordActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => ({
  ok: true,
  state: await services.discordConnectionService.setEvents(
    actor,
    projectId,
    readEvents(formData),
  ),
  test: null,
});

const handleTest: DiscordActionHandler = async ({
  actor,
  projectId,
  services,
}) => {
  const service = services.discordConnectionService;
  const test = await service.sendTest(actor, projectId);

  return { ok: true, state: await service.getState(actor, projectId), test };
};

const handleDisconnect: DiscordActionHandler = async ({
  actor,
  projectId,
  services,
}) => ({
  ok: true,
  state: await services.discordConnectionService.disconnect(actor, projectId),
  test: null,
});

const handleCancel: DiscordActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  const attemptId = readRequiredText(formData, "attemptId");

  if (attemptId === null) {
    return invalidInput();
  }

  return {
    ok: true,
    state: await services.discordConnectionService.cancelAttempt(
      actor,
      projectId,
      attemptId,
    ),
    test: null,
  };
};

const DISCORD_ACTION_HANDLERS = {
  cancel: handleCancel,
  channel: handleChannel,
  confirm: handleConfirm,
  disconnect: handleDisconnect,
  events: handleEvents,
  start: handleStart,
  test: handleTest,
} satisfies Record<string, DiscordActionHandler>;

function isDiscordIntent(
  value: unknown,
): value is keyof typeof DISCORD_ACTION_HANDLERS {
  return (
    typeof value === "string" && Object.hasOwn(DISCORD_ACTION_HANDLERS, value)
  );
}

/**
 * Runs the Discord panel action a form submission asks for.
 *
 * @param context - Actor, form fields, project and services of the request.
 * @returns The result for the panel; an unknown intent counts as invalid input.
 * @throws Whatever the services throw; callers map it with `toDiscordFailure`.
 */
export async function handleDiscordAction(
  context: DiscordActionContext,
): Promise<DiscordActionResult> {
  const intent = context.formData.get("intent");

  return isDiscordIntent(intent)
    ? DISCORD_ACTION_HANDLERS[intent](context)
    : invalidInput();
}

/**
 * Tells the HTTP status that belongs to the result of an action.
 *
 * @param result - Result of an action or of a refused request.
 * @returns 200 for a success, otherwise the status of the refusal.
 */
export function statusOfDiscordResult(result: DiscordActionResult): number {
  return result.ok ? 200 : ERROR_STATUS[result.error];
}

/**
 * Maps the failures of a Discord request to the response the panel understands.
 *
 * @param error - The failure thrown by a service.
 * @returns The result and the HTTP status; only a code reaches the client.
 * @throws The original value when it is not a known refusal.
 */
export function toDiscordFailure(error: unknown): {
  readonly result: DiscordActionResult;
  readonly status: number;
} {
  const code = toErrorCode(error);

  if (code === null) {
    throw error;
  }

  return { result: { error: code, ok: false }, status: ERROR_STATUS[code] };
}

function toErrorCode(error: unknown): DiscordActionErrorCode | null {
  if (error instanceof DiscordError) {
    return error.code;
  }

  if (
    error instanceof ProjectManagementDeniedError ||
    error instanceof ProjectAccessDeniedError
  ) {
    return "forbidden";
  }

  return error instanceof ProjectNotFoundError ? "not_found" : null;
}
