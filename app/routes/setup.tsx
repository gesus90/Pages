import { useLoaderData, useLocation, useRouteLoaderData } from "react-router";

import { AuthFooter } from "@/app/components/auth/auth-footer";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { LanguageSwitcher } from "@/app/components/login/language-switcher";
import { SetupCompleted } from "@/app/components/setup/setup-completed";
import { SetupWizard } from "@/app/components/setup/setup-wizard";
import { SETUP_FORM_FIELD } from "@/app/lib/setup/setup-action-data";
import { handleSetupAction } from "@/app/lib/setup/setup-actions.server";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { LANGUAGE } from "@/language/Language";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type {
  SetupActionData,
  SetupIntent,
  SetupLoaderData,
} from "@/app/lib/setup/setup-action-data";
import type { SetupActionResult } from "@/app/lib/setup/setup-actions.server";
import type { loader as rootLoader } from "@/app/root";
import type { Route } from "./+types/setup";

const SETUP_INTENTS: ReadonlySet<unknown> = new Set<SetupIntent>([
  "check-database-path",
  "complete",
  "verify-token",
]);

function isSetupIntent(value: unknown): value is SetupIntent {
  return SETUP_INTENTS.has(value);
}

/** Wizard requests whose answers never change what the loaders return. */
const CHECK_INTENTS: ReadonlySet<unknown> = new Set<SetupIntent>([
  "check-database-path",
  "verify-token",
]);

/**
 * Tells the wizard whether the setup is pending and whether the setup link
 * carried a valid token.
 *
 * @remarks
 * The suggested database path is only revealed together with a valid
 * token. After the setup finished, the page only offers the way to sign in.
 */
export async function loader({
  request,
}: Route.LoaderArgs): Promise<SetupLoaderData> {
  const runtime = await getPagesRuntime();

  if (!runtime.isSetupPending()) {
    return { status: "completed" };
  }

  const token = new URL(request.url).searchParams.get(SETUP_FORM_FIELD.TOKEN);

  if (token !== null && runtime.verifySetupToken(token)) {
    return {
      access: {
        suggestedDatabasePath: runtime.getSuggestedDatabasePath(),
        token,
      },
      hasRejectedToken: false,
      status: "pending",
    };
  }

  return { access: null, hasRejectedToken: token !== null, status: "pending" };
}

/** Checks the token or the database path, or finishes the setup. */
export async function action({
  request,
}: Route.ActionArgs): Promise<SetupActionResult> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  return handleSetupAction(await getPagesRuntime(), request);
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
  serverAction,
}: Route.ClientActionArgs): Promise<SetupActionData> {
  const formData = await request.clone().formData();
  const intent = formData.get(SETUP_FORM_FIELD.INTENT);

  try {
    return await serverAction();
  } catch (error: unknown) {
    if (error instanceof Response || !isSetupIntent(intent)) {
      throw error;
    }

    return { error: "network", intent };
  }
}

/**
 * Skips reloading the page data after token and path checks, which run
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
  const loaderData = useLoaderData<typeof loader>();
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
