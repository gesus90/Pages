import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { RegionProvider } from "@/app/components/common/region-provider";
import { FactRow } from "@/app/components/settings/system/system-dashboard/fact-row";
import { createI18n } from "@/app/lib/i18n";

import type { DashboardFacts } from "@/definition/SystemDashboard";
import type { UserTimezone } from "@/definition/Settings";
import type { Language } from "@/language/Language";

const BUILD = {
  commit: "281a48950123456789abcdef0123456789abcdef01",
  builtAt: "2026-11-13T10:12:00+01:00",
};
const FACTS: DashboardFacts = {
  version: "0.1.0",
  build: BUILD,
  nodeVersion: "22",
  pagesStartedAt: 0,
  serverStartedAt: null,
  databaseSize: null,
  dataDirectorySize: null,
  tools: null,
};

function renderFacts({
  language = "de",
  timezone = "Europe/Berlin",
  facts = FACTS,
}: {
  readonly language?: Language;
  readonly timezone?: UserTimezone | null;
  readonly facts?: DashboardFacts | null;
} = {}): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={createI18n(language)}>
      <RegionProvider region={{ dateFormat: "YYYY-MM-DD", timezone }}>
        <FactRow facts={facts} lastBackup={null} now={1000} />
      </RegionProvider>
    </I18nextProvider>,
  );
}

it.each([
  { language: "de" as const, date: "13.11.2026 10:12" },
  { language: "en" as const, date: "11/13/2026 10:12" },
])(
  "shows the version, eight-character build and local date in $language",
  ({ language, date }) => {
    renderFacts({ language });

    const commit = screen.getByText("Build 281a4895");
    expect(commit.getAttribute("title")).toBe(BUILD.commit);
    expect(commit.parentElement?.textContent).toBe(
      `0.1.0 · Build 281a4895 · ${date}`,
    );
  },
);

it.each([
  { language: "de" as const, date: "12.11.2026 15:12" },
  { language: "en" as const, date: "11/12/2026 15:12" },
])(
  "converts the stored offset to the visitor's time zone across midnight in $language",
  ({ language, date }) => {
    renderFacts({
      language,
      timezone: "America/Los_Angeles",
      facts: {
        ...FACTS,
        build: { ...BUILD, builtAt: "2026-11-13T00:12:00+01:00" },
      },
    });

    expect(screen.getByText("Build 281a4895").parentElement?.textContent).toBe(
      `0.1.0 · Build 281a4895 · ${date}`,
    );
  },
);

it.each([
  {
    language: "de" as const,
    builtAt: "2026-03-29T00:30:00Z",
    date: "29.03.2026 01:30",
  },
  {
    language: "de" as const,
    builtAt: "2026-03-29T01:30:00Z",
    date: "29.03.2026 03:30",
  },
  {
    language: "en" as const,
    builtAt: "2026-03-29T00:30:00Z",
    date: "03/29/2026 01:30",
  },
  {
    language: "en" as const,
    builtAt: "2026-03-29T01:30:00Z",
    date: "03/29/2026 03:30",
  },
])(
  "uses the build instant's local offset across daylight saving in $language: $builtAt",
  ({ language, builtAt, date }) => {
    renderFacts({
      language,
      facts: { ...FACTS, build: { ...BUILD, builtAt } },
    });

    expect(screen.getByText("Build 281a4895").parentElement?.textContent).toBe(
      `0.1.0 · Build 281a4895 · ${date}`,
    );
  },
);

it("uses the browser's local zone when the visitor has no explicit zone", () => {
  const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
    function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), timeZone: "America/New_York" };
    },
  );
  renderFacts({ timezone: null });

  expect(screen.getByText("Build 281a4895").parentElement?.textContent).toBe(
    "0.1.0 · Build 281a4895 · 13.11.2026 04:12",
  );
});

it.each([
  { language: "de" as const, unknown: "unbekannt" },
  { language: "en" as const, unknown: "unknown" },
])(
  "shows translated unknown metadata without a tooltip in $language",
  ({ language, unknown }) => {
    renderFacts({ language, facts: { ...FACTS, build: null } });

    const build = screen.getByText(`Build ${unknown}`);
    expect(build.parentElement?.textContent).toBe(
      `0.1.0 · Build ${unknown} · ${unknown}`,
    );
    expect(build.hasAttribute("title")).toBe(false);
  },
);

it("keeps the waiting state until system facts arrive", () => {
  const view = renderFacts({ facts: null });

  expect(
    view.container.querySelector('[data-fact="version"] dd')?.textContent,
  ).toBe("—");
  expect(screen.queryByText(/Build/u)).toBeNull();
});
