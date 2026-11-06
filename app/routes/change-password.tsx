import { useTranslation } from "react-i18next";
import { useActionData, useNavigation } from "react-router";

import { AuthHeading } from "@/app/components/auth/auth-heading";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { RequiredPasswordForm } from "@/app/components/auth/required-password-form";
import { sendToBackend } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { action } from "./change-password-server";
import type { Route } from "./+types/change-password";

/** The endpoint's answer while the password must be replaced. */
interface PasswordChangeRequired {
  readonly isPasswordChangeRequired: true;
}

function isPasswordChangeRequired(
  value: unknown,
): value is PasswordChangeRequired {
  return (
    typeof value === "object" &&
    value !== null &&
    "isPasswordChangeRequired" in value &&
    value.isPasswordChangeRequired === true
  );
}

/**
 * Lets only authenticated accounts whose password must be replaced stay,
 * as the API decides; everyone else is redirected (PAGE-235).
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<null> {
  await readRouteData({
    endpoint: `/app-api/change-password${new URL(request.url).search}`,
    signal: request.signal,
    isPayload: isPasswordChangeRequired,
  });
  return null;
}

/** Sends the new password to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Shows the mandatory password replacement without workspace navigation. */
export default function ChangePasswordRoute(): React.ReactElement {
  const { t } = useTranslation();
  const outcome = useActionData<typeof action>()?.outcome;
  const navigation = useNavigation();

  return (
    <AuthLayout>
      <AuthHeading
        title={t("settings.security.password.dialogTitle")}
        subtitle={t("settings.security.password.requiredChange")}
      />
      <RequiredPasswordForm
        outcome={outcome}
        isSubmitting={navigation.state === "submitting"}
      />
    </AuthLayout>
  );
}
