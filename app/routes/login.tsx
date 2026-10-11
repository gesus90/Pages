import { useTranslation } from "react-i18next";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import { AuthFooter } from "@/app/components/auth/auth-footer";
import { AuthHeading } from "@/app/components/auth/auth-heading";
import { AuthLayout } from "@/app/components/auth/auth-layout";
import { InstanceBrand } from "@/app/components/common/instance-brand";
import { LanguageSwitcher } from "@/app/components/login/language-switcher";
import { LoginForm } from "@/app/components/login/login-form";
import { LoginSetupHint } from "@/app/components/login/login-setup-hint";
import { getAuthenticatedUser, parseCredentials } from "@/app/lib/auth.server";
import { getClientAddress } from "@/app/lib/client-address.server";
import { resolveCookieSecure } from "@/app/lib/cookie-security.server";
import { resolveAnonymousLanguage } from "@/app/lib/language.server";
import { sessionCookie } from "@/app/lib/session.server";
import { oauthLoginDestination } from "@/app/lib/oauth-login.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { TooManyLoginAttemptsError } from "@/backend/auth/LoginThrottle";

import type { LoginFormError } from "@/app/components/login/login-form";
import type { LoginResult } from "@/backend/auth/AuthService";
import type { InstanceBranding } from "@/definition/Instance";

import type { Language } from "@/language/Language";
import type { Route } from "./+types/login";

/** Data the login page needs when it renders instead of redirecting. */
interface LoginLoaderData {
  readonly language: Language;
  /** Company name and logo, shown to visitors without a session. */
  readonly branding: InstanceBranding;
}

interface LoginActionData {
  readonly error: LoginFormError;
}

type LoginActionResult = Response | ReturnType<typeof data<LoginActionData>>;

/**
 * Redirects a visitor who already has an active Pages session.
 *
 * @remarks
 * Everyone else gets their previously selected or browser-derived language
 * so the page, including its language switcher, renders correctly.
 */
export async function loader({
  request,
}: Route.LoaderArgs): Promise<Response | LoginLoaderData> {
  const user = await getAuthenticatedUser(request);

  if (user) {
    return redirect(oauthLoginDestination(request));
  }

  const services = await getApplicationServices();

  return {
    branding: await services.instanceSettingsService.getBranding(),
    language: await resolveAnonymousLanguage(request),
  };
}

/** Validates credentials and creates a persistent browser session. */
export async function action({
  request,
}: Route.ActionArgs): Promise<LoginActionResult> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const credentials = parseCredentials(await request.formData());

  if (!credentials) {
    return data<LoginActionData>(
      { error: "invalidCredentials" },
      { status: 400 },
    );
  }

  const services = await getApplicationServices();
  let loginResult: LoginResult | null;

  try {
    loginResult = await services.authService.login(
      credentials.username,
      credentials.password,
      request.headers.get("user-agent"),
      getClientAddress(request),
    );
  } catch (error: unknown) {
    if (error instanceof TooManyLoginAttemptsError) {
      return data<LoginActionData>(
        { error: "tooManyAttempts" },
        {
          headers: { "Retry-After": String(error.retryAfterSeconds) },
          status: 429,
        },
      );
    }

    throw error;
  }

  if (!loginResult) {
    return data<LoginActionData>(
      { error: "invalidCredentials" },
      { status: 401 },
    );
  }

  return redirect(oauthLoginDestination(request), {
    headers: {
      "Set-Cookie": await sessionCookie.serialize(loginResult.sessionToken, {
        secure: resolveCookieSecure(request),
      }),
    },
  });
}

/** Renders the Pages sign-in form backed by the route action. */
export default function LoginRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { branding, language } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <AuthLayout
      header={<LanguageSwitcher language={language} redirectTo="/login" />}
      footer={<AuthFooter />}
    >
      <InstanceBrand branding={branding} className="mb-6" isCentered />
      <AuthHeading title={t("login.title")} subtitle={t("login.subtitle")} />
      <LoginForm error={actionData?.error} isSubmitting={isSubmitting} />
      <LoginSetupHint />
    </AuthLayout>
  );
}
