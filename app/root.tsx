import "@fontsource-variable/inter";
import { I18nextProvider, useTranslation } from "react-i18next";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  useRouteLoaderData,
} from "react-router";

import { buttonVariants } from "@/app/components/ui/button";
import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { cn } from "@/app/lib/cn";
import { createI18n } from "@/app/lib/i18n";
import { createSecurityHeaders } from "@/app/lib/security-headers";
import {
  resolveAnonymousLanguage,
  resolveSetupLanguage,
} from "@/app/lib/language.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  isSetupPending,
  requireFinishedSetup,
} from "@/app/lib/setup-gate.server";
import stylesheet from "@/app/styles/tailwind.css?url";
import { LANGUAGE } from "@/language/Language";

import type { ReactNode } from "react";
import type {
  HeadersFunction,
  LinksFunction,
  MetaFunction,
  MiddlewareFunction,
} from "react-router";
import type { Language } from "@/language/Language";
import type { Route } from "./+types/root";

/** Which translated copy the error page shows. */
type ErrorKind = "forbidden" | "generic" | "notFound";

const ERROR_KIND_BY_STATUS: Readonly<Partial<Record<number, ErrorKind>>> = {
  403: "forbidden",
  404: "notFound",
};

function resolveErrorKind(error: unknown): ErrorKind {
  if (!isRouteErrorResponse(error)) {
    return "generic";
  }

  return ERROR_KIND_BY_STATUS[error.status] ?? "generic";
}

/** Keeps every route but the setup wizard closed until the setup finished. */
export const middleware: MiddlewareFunction[] = [requireFinishedSetup];

/**
 * Selects the document language.
 *
 * @remarks
 * Signed-in visitors use their persisted personal language setting.
 * Everyone else falls back to their browser's `Accept-Language` preference.
 * The setup wizard starts in German unless the visitor chose a language;
 * it never touches the services, because no database exists yet.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<{
  language: Language;
}> {
  if (await isSetupPending()) {
    return { language: await resolveSetupLanguage(request) };
  }

  const user = await getAuthenticatedUser(request);

  if (user) {
    const services = await getApplicationServices();
    const settings = await services.settingsService.getUserSettings(user.id);

    return { language: settings.language };
  }

  return { language: await resolveAnonymousLanguage(request) };
}

/** Registers the global Tailwind stylesheet. */
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

/** Defines the document metadata shared by Pages routes. */
export const meta: MetaFunction = () => [{ title: "Pages" }];

/** Sends the security headers with every HTML document. */
export const headers: HeadersFunction = () => createSecurityHeaders();

/**
 * Provides the HTML document and request-scoped localization provider.
 *
 * @remarks
 * Also renders around thrown-response error pages (for example a 403 from
 * a permission check), where the router does not provide this route's own
 * loader data, so a default language is used instead.
 */
export function Layout({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const loaderData = useRouteLoaderData<typeof loader>("root");
  const language = loaderData?.language ?? LANGUAGE.GERMAN;
  const i18n = createI18n(language);

  return (
    <html lang={language}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#ffffff" />
        <link rel="icon" type="image/png" href="/assets/icon.png" />
        <Meta />
        <Links />
      </head>
      <body>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** Renders the active framework route. */
export default function Root(): React.ReactElement {
  return <Outlet />;
}

/**
 * Renders the error page for thrown responses and unexpected errors.
 *
 * @remarks
 * The copy depends on the status only. The message and stack of an
 * unexpected error are never shown, so no internal details reach visitors.
 */
export function ErrorBoundary(): React.ReactElement {
  const { t } = useTranslation();
  const error = useRouteError();
  const kind = resolveErrorKind(error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16 sm:px-6">
      <section className="w-full max-w-md rounded-3xl bg-surface p-6 text-center shadow-floating sm:p-8">
        {isRouteErrorResponse(error) ? (
          <p className="text-sm font-semibold text-primary">{error.status}</p>
        ) : null}
        <h1 className="mt-2 text-2xl leading-tight font-bold tracking-tight text-foreground sm:text-[1.875rem]">
          {t(`errorPage.${kind}.title`)}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t(`errorPage.${kind}.message`)}
        </p>
        <Link className={cn(buttonVariants(), "mt-8")} to="/">
          {t("errorPage.backToStart")}
        </Link>
      </section>
    </main>
  );
}
