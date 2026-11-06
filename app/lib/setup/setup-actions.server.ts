import { data, redirect } from "react-router";

import { resolveCookieSecure } from "@/app/lib/cookie-security.server";
import { readText } from "@/app/lib/form-fields.server";
import { resolveSetupLanguage } from "@/app/lib/language.server";
import { activateApplicationServices } from "@/app/lib/services.server";
import { sessionCookie } from "@/app/lib/session.server";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { Database } from "@/backend/database/Database";
import { checkSetupConnection } from "@/backend/setup/SetupConnection";
import { readSetupIntent } from "@/backend/setup/SetupIntent";
import { hasCommittedSetup } from "@/backend/setup/SetupPostgresRepository";
import { SetupWizardService } from "@/backend/setup/SetupWizardService";
import { DATABASE_LOCATION_STATUS } from "@/definition/Setup";

import { SETUP_FORM_FIELD } from "./setup-action-data";
import { readSetupForm } from "./setup-form.server";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { SetupCompletionResult } from "@/backend/setup/SetupWizardService";
import type {
  SetupActionData,
  SetupIntent,
  SetupRequestError,
} from "./setup-action-data";

/** A setup action answer, or the redirect into the finished instance. */
export type SetupActionResult =
  Response | ReturnType<typeof data<SetupActionData>>;

/** Everything a setup action handler needs from the request. */
interface SetupActionContext {
  readonly runtime: PagesRuntime;
  readonly request: Request;
  readonly formData: FormData;
}

const HTTP_STATUS_BY_ERROR: Readonly<Record<SetupRequestError, number>> = {
  alreadyCompleted: 409,
  failed: 500,
  invalidToken: 401,
  network: 503,
};

function reject(
  intent: SetupIntent,
  error: SetupRequestError,
): ReturnType<typeof data<SetupActionData>> {
  return data<SetupActionData>(
    { error, intent },
    { status: HTTP_STATUS_BY_ERROR[error] },
  );
}

function readToken(formData: FormData): string | null {
  return readText(formData, SETUP_FORM_FIELD.TOKEN);
}

function verifyToken({
  runtime,
  formData,
}: SetupActionContext): SetupActionResult {
  const token = readToken(formData);

  if (token === null || !runtime.verifySetupToken(token)) {
    return reject("verify-token", "invalidToken");
  }

  return data<SetupActionData>({
    access: {
      suggestedDatabaseUrl: "",
      token,
    },
    intent: "verify-token",
  });
}

async function checkDatabaseUrl({
  runtime,
  formData,
}: SetupActionContext): Promise<SetupActionResult> {
  if (!runtime.verifySetupToken(readToken(formData))) {
    return reject("check-database-connection", "invalidToken");
  }

  const input = readText(formData, SETUP_FORM_FIELD.DATABASE_URL) ?? "";
  let status = await checkSetupConnection(input);
  if (
    status === DATABASE_LOCATION_STATUS.FOREIGN &&
    (await isRecoverable(runtime, input))
  )
    status = DATABASE_LOCATION_STATUS.AVAILABLE;
  const requestId = readText(formData, "requestId") ?? "";

  return data<SetupActionData>({
    intent: "check-database-connection",
    location: { input: /^\d{1,15}$/u.test(requestId) ? requestId : "", status },
  });
}

async function isRecoverable(
  runtime: PagesRuntime,
  input: string,
): Promise<boolean> {
  try {
    const intent = await readSetupIntent(runtime.configFile.path);
    if (!intent || intent.databaseUrl !== input) return false;
    const database = await Database.connect(input);
    try {
      return await hasCommittedSetup(database, intent.sessionToken);
    } finally {
      await database.close();
    }
  } catch {
    return false;
  }
}

async function answerCompletion(
  result: SetupCompletionResult,
  request: Request,
): Promise<SetupActionResult> {
  switch (result.status) {
    case "completed":
      return redirect("/dashboard", {
        headers: {
          "Set-Cookie": await sessionCookie.serialize(result.sessionToken, {
            secure: resolveCookieSecure(request),
          }),
        },
      });
    case "databaseLocation":
      return data<SetupActionData>(
        {
          error: "databaseLocation",
          intent: "complete",
          location: { input: "", status: result.location },
        },
        { status: 409 },
      );
    case "usernameTaken":
    case "emailTaken":
      return data<SetupActionData>(
        {
          error: "invalidInput",
          fieldErrors:
            result.status === "usernameTaken"
              ? { username: "usernameTaken" }
              : { email: "emailTaken" },
          intent: "complete",
        },
        { status: 409 },
      );
    case "alreadyCompleted":
    case "invalidToken":
    case "failed":
      return reject("complete", result.status);
  }
}

async function completeSetup({
  runtime,
  request,
  formData,
}: SetupActionContext): Promise<SetupActionResult> {
  // The token is checked first, so nobody learns about field rules without it.
  if (!runtime.verifySetupToken(readToken(formData))) {
    return reject("complete", "invalidToken");
  }

  const form = readSetupForm(formData);

  if (!form.isValid) {
    return data<SetupActionData>(
      {
        error: "invalidInput",
        fieldErrors: form.fieldErrors,
        intent: "complete",
      },
      { status: 400 },
    );
  }

  const service = new SetupWizardService({
    activateServices: activateApplicationServices,
    passwordHasher: new PasswordHasher(),
    runtime,
  });
  const result = await service.complete(
    {
      ...form.input,
      language: await resolveSetupLanguage(request),
      userAgent: request.headers.get("user-agent"),
    },
    readToken(formData),
  );

  return answerCompletion(result, request);
}

const SETUP_ACTION_HANDLERS = {
  "check-database-connection": checkDatabaseUrl,
  complete: completeSetup,
  "verify-token": verifyToken,
} satisfies Record<
  SetupIntent,
  (
    context: SetupActionContext,
  ) => SetupActionResult | Promise<SetupActionResult>
>;

function isSetupIntent(value: unknown): value is SetupIntent {
  return (
    typeof value === "string" && Object.hasOwn(SETUP_ACTION_HANDLERS, value)
  );
}

/**
 * Runs the setup request a wizard form submits.
 *
 * @param runtime - Runtime of the process.
 * @param request - The submitted request.
 * @returns The answer for the wizard.
 * @throws A `400` response for an unknown intent.
 *
 * @remarks
 * Every request needs the setup token. Once the setup finished, every
 * request is refused, so the wizard cannot run twice.
 */
export async function handleSetupAction(
  runtime: PagesRuntime,
  request: Request,
): Promise<SetupActionResult> {
  const formData = await request.formData();
  const intent = formData.get(SETUP_FORM_FIELD.INTENT);

  if (!isSetupIntent(intent)) {
    throw new Response("Bad Request", { status: 400 });
  }

  if (!runtime.isSetupPending()) {
    return reject(intent, "alreadyCompleted");
  }

  return SETUP_ACTION_HANDLERS[intent]({ formData, request, runtime });
}
