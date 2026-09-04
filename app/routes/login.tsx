import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Form,
  data,
  redirect,
  useActionData,
  useNavigation,
} from "react-router";

import iconUrl from "@/assets/icon.png";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { getAuthenticatedUser, parseCredentials } from "@/app/lib/auth.server";
import { sessionCookie } from "@/app/lib/session.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

interface LoginActionData {
  readonly error: "invalidCredentials";
}

type LoginActionResult = Response | ReturnType<typeof data<LoginActionData>>;

/** Redirects a visitor who already has an active Pages session. */
export async function loader({
  request,
}: LoaderFunctionArgs): Promise<Response | null> {
  const user = await getAuthenticatedUser(request);

  return user ? redirect("/dashboard") : null;
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

/** Renders the Pages sign-in form backed by the route action. */
export default function LoginRoute(): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isSubmitting = navigation.state === "submitting";

  function handleTogglePassword(): void {
    setIsPasswordVisible((isVisible) => !isVisible);
  }

  return (
    <main className="flex min-h-screen flex-col bg-background px-6 pt-11 pb-16 sm:px-10">
      <header>
        <img className="block w-44 sm:w-32" src={iconUrl} alt="Pages" />
      </header>
      <section className="flex flex-1 flex-col justify-center self-center w-full max-w-120 pb-16">
        <h1 className="m-0 text-center text-3xl font-semibold tracking-tight text-foreground">
          {t("login.title")}
        </h1>
        <p className="mt-3 text-center text-[1.0625rem] leading-relaxed text-muted-foreground">
          {t("login.subtitle")}
        </p>

        <Form className="mt-10 flex flex-col" method="post" noValidate>
          <label className="sr-only" htmlFor="username">
            {t("login.username")}
          </label>
          <div className="relative">
            <UserRound
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="pl-12"
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              placeholder={t("login.username")}
              required
            />
          </div>

          <label className="sr-only" htmlFor="password">
            {t("login.password")}
          </label>
          <div className="relative mt-4">
            <LockKeyhole
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="pr-12 pl-12"
              id="password"
              name="password"
              type={isPasswordVisible ? "text" : "password"}
              autoComplete="current-password"
              placeholder={t("login.password")}
              required
            />
            <button
              className="absolute top-1/2 right-3 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
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

          {actionData?.error ? (
            <p
              className="mt-3 text-sm leading-relaxed text-destructive"
              role="alert"
            >
              {t(`login.error.${actionData.error}`)}
            </p>
          ) : null}

          <Button className="mt-7 w-full" type="submit" disabled={isSubmitting}>
            {isSubmitting ? t("login.submitting") : t("login.submit")}
          </Button>
        </Form>
      </section>
    </main>
  );
}
