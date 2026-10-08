import { data } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import {
  WikiAccessDeniedError,
  WikiConflictError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";

import type { RouterContextProvider } from "react-router";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { WikiErrorCode } from "@/backend/error/WikiErrors";
import type { User } from "@/definition/User";
import type { WikiPage } from "@/definition/Wiki";

/** Reasons beyond the validation codes that an action reports. */
export type WikiActionErrorCode =
  WikiErrorCode | "conflict" | "forbidden" | "invalidInput" | "notFound";

/** What the client receives after a wiki action. */
export type WikiActionResult<Payload extends object = object> =
  | ({ readonly ok: true } & Payload)
  | {
      readonly ok: false;
      readonly error: WikiActionErrorCode;
      /** The saved page, with an error of the code "conflict". */
      readonly current?: WikiPage;
    };

/** The response an action handler returns to React Router. */
export type WikiActionResponse<Payload extends object = object> = ReturnType<
  typeof data<WikiActionResult<Payload>>
>;

/** Everything a wiki action handler needs from the request. */
export interface WikiActionContext {
  readonly actor: User;
  readonly formData: FormData;
  readonly services: ApplicationServices;
  /** The page of the route, when the route belongs to one. */
  readonly pageId: string | null;
}

/** What an action returns: data for the client or a redirect. */
export type WikiActionOutcome = WikiActionResponse | Response;

/** Handles one wiki action. */
export type WikiActionHandler = (
  context: WikiActionContext,
) => Promise<WikiActionOutcome>;

/** Answers an action that succeeded without anything to report. */
export function succeeded(): WikiActionResponse {
  return data<WikiActionResult>({ ok: true });
}

/**
 * Answers an action that succeeded with values for the client.
 *
 * @param payload - Values the client needs.
 * @returns The response.
 */
export function succeededWith<Payload extends object>(
  payload: Payload,
): WikiActionResponse<Payload> {
  return data<WikiActionResult<Payload>>({ ok: true, ...payload });
}

/** Answers an action whose form fields are missing or malformed. */
export function invalidInput(): WikiActionResponse {
  return failed("invalidInput", 400);
}

function failed(
  error: WikiActionErrorCode,
  status: number,
  current?: WikiPage,
): WikiActionResponse {
  return data<WikiActionResult>(
    current ? { current, error, ok: false } : { error, ok: false },
    { status },
  );
}

/**
 * Maps the failures of a wiki action to client responses.
 *
 * @param error - The failure thrown by a service.
 * @returns The response describing the failure.
 * @throws The original value when it is none of the wiki failures.
 */
export function toWikiActionError(error: unknown): WikiActionResponse {
  if (error instanceof WikiValidationError) {
    return failed(error.code, 400);
  }

  if (error instanceof WikiConflictError) {
    return failed("conflict", 409, error.current);
  }

  if (error instanceof WikiPageNotFoundError) {
    return failed("notFound", 404);
  }

  if (
    error instanceof WikiAccessDeniedError ||
    error instanceof ProjectAccessDeniedError ||
    error instanceof InstanceSettingsDeniedError
  ) {
    return failed("forbidden", 403);
  }

  throw error;
}

/**
 * Checks a wiki form submission and gathers what its handler needs.
 *
 * @param args - Request and route context of the action.
 * @param pageId - The page of the route, or `null`.
 * @returns User, form fields and services of the submission.
 * @throws A `405` response for anything but a POST and a `403` response
 * without a signed-in user.
 */
export async function readWikiRequest(
  args: {
    readonly request: Request;
    readonly context: Readonly<RouterContextProvider>;
  },
  pageId: string | null,
): Promise<WikiActionContext> {
  if (args.request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const actor = args.context.get(authenticatedUserContext);

  if (!actor) {
    throw new Response("Forbidden", { status: 403 });
  }

  return {
    actor,
    formData: await args.request.formData(),
    pageId,
    services: await getApplicationServices(),
  };
}

/**
 * Runs the handler of an intent and turns wiki failures into responses.
 *
 * @param handlers - Handler per intent.
 * @param context - The submission.
 * @returns The handler's response, or a failure response.
 */
export async function runWikiAction(
  handlers: Readonly<Record<string, WikiActionHandler>>,
  context: WikiActionContext,
): Promise<WikiActionOutcome> {
  const intent = context.formData.get("intent");
  const handler = typeof intent === "string" ? handlers[intent] : undefined;

  if (!handler) {
    return invalidInput();
  }

  try {
    return await handler(context);
  } catch (error: unknown) {
    return toWikiActionError(error);
  }
}
