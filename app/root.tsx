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
  useLocation,
  useRouteError,
  useRouteLoaderData,
} from "react-router";

import { useDocumentDesignTheme } from "@/app/components/common/use-document-design-theme";
import { useDocumentTheme } from "@/app/components/common/use-document-theme";
import { DraftProvider } from "@/app/components/common/draft-provider";
import { useServiceWorker } from "@/app/components/common/use-service-worker";
import { useSupersededSession } from "@/app/components/common/use-superseded-session";
import { BackgroundSaveStatus } from "@/app/components/common/background-save-status";
import { ServiceStatusLight } from "@/app/components/common/service-status-light";
import { buttonVariants } from "@/app/components/ui/button";
import { Toaster } from "@/app/components/ui/toast";
import {
  getColorSchemeMeta,
  getThemeColorMetas,
} from "@/app/lib/document-theme";
import { createI18n } from "@/app/lib/i18n";
import { loadRoot } from "@/app/lib/local-state/root-loader";
import { isLocalStateNavigation } from "@/app/lib/local-state/local-state-navigation";
import {
  isTaskOverlayMutation,
  isTaskOverlayNavigation,
} from "@/app/lib/task-overlay-navigation";
import stylesheet from "@/app/styles/tailwind.css?url";
import favicon from "@/assets/favicon.svg?url&no-inline";
import { LANGUAGE } from "@/language/Language";

import type { ReactNode } from "react";
import type {
  LinksFunction,
  MetaFunction,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { RootData } from "@/app/lib/root-data";
import type { Route } from "./+types/root";

/** Which translated copy the error page shows. */
type ErrorKind =
  "forbidden" | "generic" | "notFound" | "outcomeUnknown" | "unavailable";

const ERROR_KIND_BY_STATUS: Readonly<Partial<Record<number, ErrorKind>>> = {
  403: "forbidden",
  404: "notFound",
  503: "unavailable",
};

/** Error kinds whose page offers to load the current address again. */
const RELOADABLE_ERROR_KINDS: ReadonlySet<ErrorKind> = new Set([
  "outcomeUnknown",
  "unavailable",
]);

/** Whether the database stopped during a change, so it may or may not be saved. */
function isOutcomeUnknown(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    body.error === "database_outcome_unknown"
  );
}

function resolveErrorKind(error: unknown): ErrorKind {
  if (!isRouteErrorResponse(error)) {
    return "generic";
  }

  if (error.status === 503 && isOutcomeUnknown(error.data)) {
    return "outcomeUnknown";
  }

  return ERROR_KIND_BY_STATUS[error.status] ?? "generic";
}

/** Pages a visitor reaches when the account changes or its session ended. */
const ACCOUNT_BOUNDARY_PATHS: ReadonlySet<string> = new Set([
  "/login",
  "/change-password",
]);

/**
 * Keeps the shell settings when only a board overlay opens or closes or a
 * local-state route opens; reads them again on the way to the sign-in page.
 *
 * @remarks
 * A route that finds the session ended redirects to the sign-in page during
 * a client navigation (PAGE-235). The root loader then names the visitor
 * anew, so the previous account's kept answers and drafts leave the page.
 */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
  if (
    ACCOUNT_BOUNDARY_PATHS.has(args.nextUrl.pathname) &&
    args.currentUrl.pathname !== args.nextUrl.pathname
  )
    return true;
  return isTaskOverlayNavigation(args) ||
    isTaskOverlayMutation(args) ||
    isLocalStateNavigation(args)
    ? false
    : args.defaultShouldRevalidate;
}

/**
 * Loads the document language, color mode and design theme from the API.
 *
 * @remarks
 * The static app has no server rendering (PAGE-235); `/app-api/root`
 * answers what the root loader answered before. It also names the
 * document's account for the browser's local state, and opens the document
 * from that state when the backend is down (see `loadRoot`).
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<RootData>> {
  return loadRoot(request.signal);
}

/** Shown in the static `index.html` until the root loader answered. */
export function HydrateFallback(): React.ReactElement {
  return <div aria-busy="true" className="min-h-screen bg-background" />;
}

/** Registers the global Tailwind stylesheet and the Pages project favicon. */
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "icon", type: "image/svg+xml", sizes: "any", href: favicon },
];

/** Defines the document metadata shared by Pages routes. */
export const meta: MetaFunction = () => [{ title: "Pages" }];

/**
 * Provides the HTML document and request-scoped localization provider.
 *
 * @remarks
 * The color mode and the design theme are written to the document root, and
 * the stylesheet of a design theme sits in the head, once the root loader
 * answered; the static `index.html` renders with the defaults. Also renders
 * around thrown-response error pages (for example a 403 from a permission
 * check), where the router does not provide this route's own loader data,
 * so a default language, mode and design are used instead. The root loader
 * names the account of the browser's local state (see `loadRoot`).
 */
export function Layout({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const loaderData = useRouteLoaderData<typeof clientLoader>("root");
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
  // Another tab changed the browser's account: nothing of this one stays visible.
  const isSuperseded = useSupersededSession();

  return (
    <html lang={language} data-design-theme={designTheme.id} data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        {/* The static document opens every page, also pairing or an MCP consent
            with a code in the address after an in-app navigation, which no
            header can follow; so no request of the app names its address. */}
        <meta name="referrer" content="no-referrer" />
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
        <Meta />
        <Links />
        {designTheme.stylesheet === null ? null : (
          <style id="design-theme-stylesheet">{designTheme.stylesheet}</style>
        )}
      </head>
      <body>
        <I18nextProvider i18n={i18n}>
          <DraftProvider
            key={draftOwnerId ?? "anonymous"}
            ownerId={draftOwnerId}
          >
            {isSuperseded ? null : (
              <>
                {children}
                <Toaster />
                <ServiceStatusLight />
              </>
            )}
          </DraftProvider>
        </I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** Renders the active framework route and keeps the app available offline. */
export default function Root(): React.ReactElement {
  useServiceWorker();
  return <Outlet />;
}

/**
 * Renders the error page for thrown responses and unexpected errors.
 *
 * @remarks
 * The copy depends on the status only, and for a `503` of the database
 * executor on whether a change may have been saved. The message and stack
 * of an unexpected error are never shown, so no internal details reach
 * visitors. A busy or unavailable database offers to load the page again.
 */
export function ErrorBoundary(): React.ReactElement {
  const { t } = useTranslation();
  const error = useRouteError();
  const location = useLocation();
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
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {RELOADABLE_ERROR_KINDS.has(kind) ? (
            <a
              className={buttonVariants({ variant: "outline" })}
              href={`${location.pathname}${location.search}`}
            >
              {t("errorPage.reload")}
            </a>
          ) : null}
          <Link className={buttonVariants()} to="/">
            {t("errorPage.backToStart")}
          </Link>
        </div>
      </section>
    </main>
  );
}
