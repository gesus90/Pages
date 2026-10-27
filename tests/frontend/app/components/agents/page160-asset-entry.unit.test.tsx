import { render, screen, cleanup } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { PlanAssetEntry } from "@/app/components/agents/plans/plan-asset-entry";
import { createI18n } from "@/app/lib/i18n";

import type { Language } from "@/language/Language";
import type { PlanRemoteFile } from "@/definition/AgentPlanRemoteAccess";

const ORIGINAL: PlanRemoteFile = {
  parameter: "source",
  name: "diagram.svg",
  type: "image/svg+xml",
  size: 123,
  digest: "a".repeat(64),
  representation: "source",
  asset: {
    source: "wiki",
    id: "attachment",
    link: "/wiki/attachments/attachment",
  },
};

describe("asset representation labels", () => {
  it.each(["de", "en"] as const)(
    "labels an SVG source and links the original in %s",
    (language: Language) => {
      const i18n = createI18n(language);
      render(
        <I18nextProvider i18n={i18n}>
          <ul>
            <PlanAssetEntry file={ORIGINAL} />
          </ul>
        </I18nextProvider>,
      );
      const link = screen.getByRole("link", {
        name: i18n.t("plans.remoteAccess.original"),
      });
      expect(link.getAttribute("href")).toBe(ORIGINAL.asset?.link);
      expect(link.hasAttribute("download")).toBe(true);
      expect(
        screen.getByText(i18n.t("plans.remoteAccess.source")),
      ).toBeTruthy();
      expect(document.querySelector("svg, iframe, script")).toBeNull();
      cleanup();
    },
  );

  it("distinguishes an incomplete PDF extract and original-only status without implying image content", () => {
    const i18n = createI18n("en");
    render(
      <I18nextProvider i18n={i18n}>
        <ul>
          <PlanAssetEntry
            file={{
              ...ORIGINAL,
              type: "application/pdf",
              representation: "text-extract",
              modelContent: "pdf-noText",
              isTruncated: true,
            }}
          />
        </ul>
      </I18nextProvider>,
    );
    expect(
      screen.getByText(i18n.t("plans.remoteAccess.truncated")),
    ).toBeTruthy();
    expect(
      screen.getByText(
        i18n.t("plans.remoteAccess.file-only", { reason: "pdf-noText" }),
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

it.each(["uploaded", "staged"] as const)(
  "shows the server-confirmed %s outcome",
  (outcome) => {
    const i18n = createI18n("en");
    render(
      <I18nextProvider i18n={i18n}>
        <ul>
          <PlanAssetEntry file={{ ...ORIGINAL, outcome }} />
        </ul>
      </I18nextProvider>,
    );
    expect(
      screen.getByText(i18n.t(`plans.remoteAccess.${outcome}`)),
    ).toBeTruthy();
  },
);
