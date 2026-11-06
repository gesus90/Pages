import { useTranslation } from "react-i18next";
import { useActionData, useLoaderData, useNavigation } from "react-router";

import { AuthFooter } from "@/app/components/auth/auth-footer";
import { AuthHeading } from "@/app/components/auth/auth-heading";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { InstanceBrand } from "@/app/components/common/instance-brand";
import { LanguageSwitcher } from "@/app/components/login/language-switcher";
import { LoginForm } from "@/app/components/login/login-form";
import { LoginSetupHint } from "@/app/components/login/login-setup-hint";
import { sendToBackend } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";
import { isLanguage } from "@/language/Language";

import type { LoginFormError } from "@/app/components/login/login-form";
import type { InstanceBranding } from "@/definition/Instance";
import type { Language } from "@/language/Language";
import type { action } from "./login-server";
import type { Route } from "./+types/login";

/** Data the login page needs when it renders instead of redirecting. */
export interface LoginLoaderData {
  readonly language: Language;
  /** Company name and logo, shown to visitors without a session. */
  readonly branding: InstanceBranding;
  /** Sign-in path retaining the validated pairing destination after language changes. */
  readonly loginPath: string;
}

/** Why the sign-in failed, as the action answers it. */
export interface LoginActionData {
  readonly error: LoginFormError;
}

function isLoginLoaderData(value: unknown): value is LoginLoaderData {
  return (
    typeof value === "object" &&
    value !== null &&
    "language" in value &&
    isLanguage(value.language) &&
    "branding" in value &&
    typeof value.branding === "object" &&
    value.branding !== null &&
    "loginPath" in value &&
    typeof value.loginPath === "string"
  );
}

/**
 * Reads the sign-in page from the API, or follows its redirect when a
 * session is active (PAGE-235).
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<LoginLoaderData> {
  return readRouteData({
    endpoint: `/app-api/login${new URL(request.url).search}`,
    signal: request.signal,
    isPayload: isLoginLoaderData,
  });
}

/** Sends the credentials to the API, which runs the sign-in action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders the Pages sign-in form backed by the route action. */
export default function LoginRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { branding, language, loginPath } =
    useLoaderData<typeof clientLoader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <AuthLayout
      header={<LanguageSwitcher language={language} redirectTo={loginPath} />}
      footer={<AuthFooter />}
    >
      <InstanceBrand branding={branding} className="mb-6" isCentered />
      <AuthHeading title={t("login.title")} subtitle={t("login.subtitle")} />
      <LoginForm error={actionData?.error} isSubmitting={isSubmitting} />
      <LoginSetupHint />
    </AuthLayout>
  );
}
