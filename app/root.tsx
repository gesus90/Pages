import { I18nextProvider } from "react-i18next";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";

import { createI18n } from "@/app/lib/i18n";
import stylesheet from "@/app/styles/tailwind.css?url";
import { resolveLanguage } from "@/language/Language";

import type { ReactNode } from "react";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import type { Language } from "@/language/Language";

/** Selects the document language from the visitor's request. */
export function loader({ request }: LoaderFunctionArgs): {
  language: Language;
} {
  const languagePreference =
    request.headers.get("Accept-Language") ?? undefined;

  return { language: resolveLanguage(languagePreference) };
}

/** Registers the global Tailwind stylesheet. */
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

/** Defines the document metadata shared by Pages routes. */
export const meta: MetaFunction = () => [{ title: "Pages" }];

/** Provides the HTML document and request-scoped localization provider. */
export function Layout({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const { language } = useLoaderData<typeof loader>();
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
