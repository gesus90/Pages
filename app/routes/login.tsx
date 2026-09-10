import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Rocket,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Form,
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";

import iconUrl from "@/assets/icon.png";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { Input } from "@/app/components/ui/input";
import { getAuthenticatedUser, parseCredentials } from "@/app/lib/auth.server";
import { resolveAnonymousLanguage } from "@/app/lib/language.server";
import { sessionCookie } from "@/app/lib/session.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { LANGUAGE } from "@/language/Language";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Language } from "@/language/Language";

const PAGES_VERSION = "0.1.0";

/** Data the login page needs when it renders instead of redirecting. */
interface LoginLoaderData {
  readonly language: Language;
}

interface LoginActionData {
  readonly error: "invalidCredentials";
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
}: LoaderFunctionArgs): Promise<Response | LoginLoaderData> {
  const user = await getAuthenticatedUser(request);

  if (user) {
    return redirect("/dashboard");
  }

  return { language: await resolveAnonymousLanguage(request) };
}

/** Validates credentials and creates a persistent browser session. */
export async function action({
  request,
}: ActionFunctionArgs): Promise<LoginActionResult> {
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
  const loginResult = await services.authService.login(
    credentials.username,
    credentials.password,
  );

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

interface LanguageSwitcherProps {
  readonly language: Language;
}

/** Renders a compact language switcher that persists its choice for anonymous visitors. */
function LanguageSwitcher({
  language: initialLanguage,
}: LanguageSwitcherProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [language, setLanguage] = useState<Language>(initialLanguage);

  function handleChange(nextLanguage: string): void {
    const language = nextLanguage as Language;

    setLanguage(language);

    const formData = new FormData();
    formData.set("redirectTo", "/login");
    formData.set("language", language);
    void submit(formData, { action: "/set-language", method: "post" });
  }

  return (
    <Select
      id="login-language"
      ariaLabel={t("settings.language.label")}
      value={language}
      onValueChange={handleChange}
      className="h-9 min-w-20 cursor-pointer"
      options={[
        { value: LANGUAGE.GERMAN, label: "DE" },
        { value: LANGUAGE.ENGLISH, label: "EN" },
      ]}
    />
  );
}

/** Renders the Pages sign-in form backed by the route action. */
export default function LoginRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { language } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isSubmitting = navigation.state === "submitting";

  function handleTogglePassword(): void {
    setIsPasswordVisible((isVisible) => !isVisible);

    // Keep the focus inside the password field when toggling visibility.
    requestAnimationFrame(() => {
      const passwordInput = document.getElementById("password");

      if (passwordInput instanceof HTMLInputElement) {
        passwordInput.focus({ preventScroll: true });
      }
    });
  }

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

        <Form className="mt-8 flex flex-col" method="post" noValidate>
          <div>
            <label
              className="mb-2 block text-sm font-semibold text-foreground"
              htmlFor="username"
            >
              {t("login.username")}
            </label>
            <div className="relative">
              <UserRound
                className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                className="h-12 rounded-xl border border-[#e5e8ee] bg-[#f8f9fb] pr-4 pl-12 text-base hover:border-[#d3d8e0] focus-visible:border-primary sm:h-14 xl:h-14 xl:pr-4 xl:pl-12 xl:text-base"
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                placeholder={t("login.username")}
                required
              />
            </div>
          </div>

          <div className="mt-5">
            <label
              className="mb-2 block text-sm font-semibold text-foreground"
              htmlFor="password"
            >
              {t("login.password")}
            </label>
            <div className="relative">
              <LockKeyhole
                className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                className="h-12 rounded-xl border border-[#e5e8ee] bg-[#f8f9fb] pr-14 pl-12 text-base hover:border-[#d3d8e0] focus-visible:border-primary sm:h-14 xl:h-14 xl:pr-14 xl:pl-12 xl:text-base"
                id="password"
                name="password"
                type={isPasswordVisible ? "text" : "password"}
                autoComplete="current-password"
                placeholder={t("login.password")}
                required
              />
              <button
                className="absolute top-1/2 right-3 inline-flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                type="button"
                aria-label={
                  isPasswordVisible
                    ? t("login.hidePassword")
                    : t("login.showPassword")
                }
                aria-pressed={isPasswordVisible}
                onClick={handleTogglePassword}
              >
                {isPasswordVisible ? (
                  <EyeOff className="size-5" aria-hidden="true" />
                ) : (
                  <Eye className="size-5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div className="mt-3 min-h-6" aria-live="polite">
            {actionData?.error ? (
              <p
                className="text-sm leading-relaxed text-destructive"
                role="alert"
              >
                {t(`login.error.${actionData.error}`)}
              </p>
            ) : null}
          </div>

          <Button
            className="relative mt-6 h-12 w-full rounded-xl bg-gradient-to-r from-[#ffa25e] to-primary px-6 text-base font-semibold text-primary-foreground shadow-[0_10px_24px_-8px_rgb(249_115_22/45%)] transition-all hover:-translate-y-[1px] hover:brightness-[1.04] active:translate-y-0 active:brightness-95 sm:h-14 xl:h-14 xl:text-base"
            type="submit"
            disabled={isSubmitting}
          >
            <span className="mx-auto">
              {isSubmitting ? t("login.submitting") : t("login.submit")}
            </span>
            <ArrowRight
              className="pointer-events-none absolute top-1/2 right-6 size-5 -translate-y-1/2"
              aria-hidden="true"
            />
          </Button>
        </Form>

        <div className="mt-8 border-t border-[#edf0f4] pt-6">
          <div className="flex items-start gap-4 text-left">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary">
              <Rocket className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-foreground">
                {t("login.setup.title")}
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                {t("login.setup.description")}
              </span>
            </span>
          </div>
        </div>
      </section>

      <footer className="absolute inset-x-0 bottom-0 px-6 py-6 text-xs sm:px-10">
        <p className="select-none font-semibold text-foreground">
          Pages v{PAGES_VERSION}
        </p>
        <p className="mt-0.5 select-none text-muted-foreground">
          {t("login.footer.tagline")}
        </p>
      </footer>
    </main>
  );
}
