import { I18nextProvider } from "react-i18next";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";

import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { createI18n } from "@/app/lib/i18n";
import { resolveAnonymousLanguage } from "@/app/lib/language.server";
import { getApplicationServices } from "@/app/lib/services.server";
import stylesheet from "@/app/styles/tailwind.css?url";
import { LANGUAGE } from "@/language/Language";

import type { ReactNode } from "react";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import type { Language } from "@/language/Language";

/**
 * Selects the document language.
 *
 * @remarks
 * Signed-in visitors use their persisted personal language setting.
 * Everyone else falls back to their browser's `Accept-Language` preference.
 */
export async function loader({ request }: LoaderFunctionArgs): Promise<{
  language: Language;
}> {
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
  const loaderData = useLoaderData<typeof loader>() as
    { language: Language } | undefined;
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
