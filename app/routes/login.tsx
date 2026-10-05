import { useTranslation } from "react-i18next";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import iconUrl from "@/assets/icon.png";
import { LanguageSwitcher } from "@/app/components/login/language-switcher";
import { LoginFooter } from "@/app/components/login/login-footer";
import { LoginForm } from "@/app/components/login/login-form";
import { LoginSetupHint } from "@/app/components/login/login-setup-hint";
import { getAuthenticatedUser, parseCredentials } from "@/app/lib/auth.server";
import { getClientAddress } from "@/app/lib/client-address.server";
import { resolveAnonymousLanguage } from "@/app/lib/language.server";
import { sessionCookie } from "@/app/lib/session.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { TooManyLoginAttemptsError } from "@/backend/auth/LoginThrottle";

import type { LoginFormError } from "@/app/components/login/login-form";
import type { LoginResult } from "@/backend/auth/AuthService";

import type { Language } from "@/language/Language";
import type { Route } from "./+types/login";

/** Data the login page needs when it renders instead of redirecting. */
interface LoginLoaderData {
  readonly language: Language;
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
    return redirect("/dashboard");
  }

  return { language: await resolveAnonymousLanguage(request) };
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

  return redirect("/dashboard", {
    headers: {
      "Set-Cookie": await sessionCookie.serialize(loginResult.sessionToken),
    },
  });
}

/** Renders the Pages sign-in form backed by the route action. */
export default function LoginRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { language } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-24 sm:px-6 sm:py-16">
      <div
        className="pointer-events-none absolute -top-32 left-[8%] size-[20rem] rounded-full bg-[#ffe8d6]/60 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-32 -bottom-40 size-[24rem] rounded-full bg-[#dbe7ff]/60 blur-3xl"
        aria-hidden="true"
      />

      <header className="absolute inset-x-0 top-0 flex items-center justify-end px-4 py-5 sm:px-10 sm:py-6">
        <LanguageSwitcher language={language} />
      </header>

      <section className="relative z-10 w-full max-w-md rounded-3xl bg-surface p-6 shadow-floating sm:p-8">
        <img
          className="mx-auto h-auto w-[140px] select-none sm:w-[160px]"
          src={iconUrl}
          alt="Pages"
          draggable={false}
        />

        <h1 className="mt-8 text-center text-2xl leading-tight font-bold tracking-tight text-foreground sm:text-[1.875rem]">
          {t("login.title")}
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t("login.subtitle")}
        </p>

        <LoginForm error={actionData?.error} isSubmitting={isSubmitting} />
        <LoginSetupHint />
      </section>

      <LoginFooter />
    </main>
  );
}
