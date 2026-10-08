import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { vi } from "vitest";

import { RegionProvider } from "@/app/components/common/region-provider";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { RenderResult } from "@testing-library/react";
import type { DataRouter } from "react-router";

/** One form a wiki action received. */
export type Submission = Record<string, string | string[]>;

/** Options of {@link renderInWiki}. */
export interface WikiRenderOptions {
  /** Address to start at; the page routes live below `/wiki`. */
  readonly path?: string;
  /** Answers of the layout action (`/wiki`), by intent. */
  readonly layoutAnswers?: Readonly<Record<string, unknown>>;
  /** Answers of the page action (`/wiki/:pageId`), by intent. */
  readonly pageAnswers?: Readonly<Record<string, unknown>>;
  /** Data of the layout loader (route id `routes/wiki`). */
  readonly shell?: unknown;
  /** Answers of the JSON endpoints, by path; the request is recorded. */
  readonly endpoints?: Readonly<Record<string, (url: URL) => unknown>>;
  /** Language of the texts. */
  readonly language?: (typeof LANGUAGE)[keyof typeof LANGUAGE];
}

/** A rendered wiki screen with the forms its actions received. */
export interface WikiRendered extends RenderResult {
  readonly router: DataRouter;
  readonly layoutSubmissions: Submission[];
  readonly pageSubmissions: Submission[];
  /** Addresses requested from the JSON endpoints. */
  readonly loads: string[];
}

function toSubmission(formData: FormData): Submission {
  const submission: Submission = {};

  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key).map(String);

    submission[key] = values.length === 1 ? (values[0] ?? "") : values;
  }

  return submission;
}

/**
 * Renders a wiki component inside a data router whose actions record what
 * they receive, so tests can check the forms and answer them.
 *
 * @param ui - The element to render at every wiki address.
 * @param options - Start address, action answers and layout data.
 * @returns The render result with the recorded submissions.
 */
export function renderInWiki(
  ui: React.ReactElement,
  options: WikiRenderOptions = {},
): WikiRendered {
  const layoutSubmissions: Submission[] = [];
  const pageSubmissions: Submission[] = [];
  const loads: string[] = [];
  const endpoint = (path: string) => ({
    loader: ({ request }: { request: Request }) => {
      loads.push(request.url.replace("http://localhost", ""));

      return options.endpoints?.[path]?.(new URL(request.url)) ?? {};
    },
    path,
  });
  const answer =
    (
      into: Submission[],
      answers: Readonly<Record<string, unknown>> | undefined,
    ) =>
    async ({ request }: { request: Request }) => {
      const submission = toSubmission(await request.formData());

      into.push(submission);

      return answers?.[String(submission.intent)] ?? { ok: true };
    };
  const router = createMemoryRouter(
    [
      endpoint("/wiki-api/references"),
      endpoint("/wiki-api/search"),
      {
        action: answer(layoutSubmissions, options.layoutAnswers),
        children: [
          { element: ui, index: true },
          { element: <p>trash</p>, path: "trash" },
          {
            action: answer(pageSubmissions, options.pageAnswers),
            element: ui,
            path: ":pageId/:slug?",
          },
        ],
        element: <Outlet />,
        id: "routes/wiki",
        loader: () => options.shell ?? null,
        path: "/wiki",
      },
    ],
    { initialEntries: [options.path ?? "/wiki"] },
  );
  const rendered = render(
    <I18nextProvider i18n={createI18n(options.language ?? LANGUAGE.ENGLISH)}>
      <RegionProvider region={{ dateFormat: "YYYY-MM-DD", timezone: "UTC" }}>
        <RouterProvider router={router} />
      </RegionProvider>
    </I18nextProvider>,
  );

  return { ...rendered, layoutSubmissions, loads, pageSubmissions, router };
}

/** A spy that records calls, for callbacks of components. */
export function spy(): ReturnType<typeof vi.fn> {
  return vi.fn();
}
