import "@fontsource-variable/inter";
import { useState } from "react";
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

import { useDocumentDesignTheme } from "@/app/components/common/use-document-design-theme";
import { useDocumentTheme } from "@/app/components/common/use-document-theme";
import { DraftProvider } from "@/app/components/common/draft-provider";
import { BackgroundSaveStatus } from "@/app/components/common/background-save-status";
import { buttonVariants } from "@/app/components/ui/button";
import { Toaster } from "@/app/components/ui/toast";
import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { cn } from "@/app/lib/cn";
import {
  getColorSchemeMeta,
  getThemeColorMetas,
} from "@/app/lib/document-theme";
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
import { STANDARD_ACTIVE_DESIGN_THEME } from "@/definition/DesignTheme";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";
import { LANGUAGE } from "@/language/Language";

import type { ReactNode } from "react";
import type {
  HeadersFunction,
  LinksFunction,
  MetaFunction,
  MiddlewareFunction,
} from "react-router";
import type { ActiveDesignTheme } from "@/definition/DesignTheme";
import type { UserTheme } from "@/definition/Settings";
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
 * Selects the document language, color mode and design theme.
 *
 * @remarks
 * Signed-in visitors use their persisted personal language, color mode and
 * design theme. Everyone else falls back to their browser's
 * `Accept-Language` preference, to the default mode `system`, which follows
 * the operating system, and to the Standard design. The setup wizard starts
 * in German unless the visitor chose a language; it never touches the
 * services, because no database exists yet.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<{
  language: Language;
  theme: UserTheme;
  designTheme: ActiveDesignTheme;
  draftOwnerId: string | null;
}> {
  const { theme: defaultTheme } = DEFAULT_USER_SETTINGS;

  if (await isSetupPending()) {
    return {
      language: await resolveSetupLanguage(request),
      theme: defaultTheme,
      designTheme: STANDARD_ACTIVE_DESIGN_THEME,
      draftOwnerId: null,
    };
  }

  const user = await getAuthenticatedUser(request);

  if (user) {
    const services = await getApplicationServices();
    const [settings, designTheme] = await Promise.all([
      services.settingsService.getUserSettings(user.id),
      services.designThemeService.getActiveTheme(user.id),
    ]);

    return {
      language: settings.language,
      theme: settings.theme,
      designTheme,
      draftOwnerId: user.id,
    };
  }

  return {
    language: await resolveAnonymousLanguage(request),
    theme: defaultTheme,
    designTheme: STANDARD_ACTIVE_DESIGN_THEME,
    draftOwnerId: null,
  };
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
 * The color mode and the design theme are written to the document root, and
 * the stylesheet of a design theme sits in the head, so the server renders
 * what the client hydrates and no script is needed to choose a palette. Also
 * renders around thrown-response error pages (for example a 403 from a
 * permission check), where the router does not provide this route's own
 * loader data, so a default language, mode and design are used instead.
 */
export function Layout({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const loaderData = useRouteLoaderData<typeof loader>("root");
  const language = loaderData?.language ?? LANGUAGE.GERMAN;
  const theme = useDocumentTheme(loaderData?.theme);
  const designTheme = useDocumentDesignTheme(loaderData?.designTheme);
  const i18n = createI18n(language);
  const [draftOwnerId, setDraftOwnerId] = useState(
    loaderData?.draftOwnerId ?? null,
  );
  // A route error may omit root data. Keep its account's drafts while the
  // error page renders; a confirmed session change starts an isolated queue.
  if (loaderData && loaderData.draftOwnerId !== draftOwnerId) {
    setDraftOwnerId(loaderData.draftOwnerId);
  }

  return (
    <html lang={language} data-design-theme={designTheme.id} data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content={getColorSchemeMeta(theme)} />
        {getThemeColorMetas(theme).map((color) => (
          <meta
            content={color.content}
            key={color.media ?? "always"}
            media={color.media}
            name="theme-color"
          />
        ))}
        <link rel="icon" type="image/png" href="/assets/icon.png" />
        <Meta />
        <Links />
        {designTheme.stylesheet === null ? null : (
          <style id="design-theme-stylesheet">{designTheme.stylesheet}</style>
        )}
      </head>
      <body>
        <I18nextProvider i18n={i18n}>
          <DraftProvider key={draftOwnerId ?? "anonymous"}>
            {children}
            <Toaster />
          </DraftProvider>
        </I18nextProvider>
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
        <BackgroundSaveStatus />
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
