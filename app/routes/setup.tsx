import { useLoaderData, useLocation, useRouteLoaderData } from "react-router";

import { AuthFooter } from "@/app/components/auth/auth-footer";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { LanguageSwitcher } from "@/app/components/login/language-switcher";
import { SetupCompleted } from "@/app/components/setup/setup-completed";
import { SetupWizard } from "@/app/components/setup/setup-wizard";
import {
  isSetupActionData,
  isSetupLoaderData,
  SETUP_FORM_FIELD,
} from "@/app/lib/setup/setup-action-data";
import { sendToBackend } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";
import { LANGUAGE } from "@/language/Language";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type {
  SetupActionData,
  SetupIntent,
  SetupLoaderData,
} from "@/app/lib/setup/setup-action-data";
import type { clientLoader as rootLoader } from "@/app/root";
import type { Route } from "./+types/setup";

const SETUP_INTENTS: ReadonlySet<unknown> = new Set<SetupIntent>([
  "check-database-connection",
  "complete",
  "verify-token",
]);

function isSetupIntent(value: unknown): value is SetupIntent {
  return SETUP_INTENTS.has(value);
}

/** Wizard requests whose answers never change what the loaders return. */
const CHECK_INTENTS: ReadonlySet<unknown> = new Set<SetupIntent>([
  "check-database-connection",
  "verify-token",
]);

/**
 * Reads from the API whether the setup is pending and whether the setup link
 * carried a valid token (PAGE-235).
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<SetupLoaderData> {
  return readRouteData({
    endpoint: `/app-api/setup${new URL(request.url).search}`,
    signal: request.signal,
    isPayload: isSetupLoaderData,
  });
}

/**
 * Turns a lost connection into an answer the wizard shows inline.
 *
 * @remarks
 * Without this, a failed request would replace the wizard with the error
 * page and lose the entered values. Redirects and error responses of the
 * server pass through unchanged.
 */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<SetupActionData> {
  const formData = await request.clone().formData();
  const intent = formData.get(SETUP_FORM_FIELD.INTENT);

  try {
    const answer = await sendToBackend(request);
    if (!isSetupActionData(answer))
      throw new Error("The setup action answered in another form.");
    return answer;
  } catch (error: unknown) {
    if (error instanceof Response || !isSetupIntent(intent)) {
      throw error;
    }

    return { error: "network", intent };
  }
}

/**
 * Skips reloading the page data after token and connection checks, which run
 * while typing.
 */
export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (CHECK_INTENTS.has(formData?.get(SETUP_FORM_FIELD.INTENT))) {
    return false;
  }

  return defaultShouldRevalidate;
}

/** Renders the setup wizard on the stage of the login page. */
export default function SetupRoute(): React.ReactElement {
  const loaderData = useLoaderData<typeof clientLoader>();
  const rootData = useRouteLoaderData<typeof rootLoader>("root");
  const location = useLocation();

  return (
    <AuthLayout
      header={
        <LanguageSwitcher
          language={rootData?.language ?? LANGUAGE.GERMAN}
          redirectTo={`${location.pathname}${location.search}`}
        />
      }
      footer={<AuthFooter />}
    >
      {loaderData.status === "completed" ? (
        <SetupCompleted />
      ) : (
        <SetupWizard
          initialAccess={loaderData.access}
          hasRejectedToken={loaderData.hasRejectedToken}
        />
      )}
    </AuthLayout>
  );
}
