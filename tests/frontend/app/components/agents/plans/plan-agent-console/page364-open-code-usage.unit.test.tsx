import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { OpenCodeUsageSection } from "@/app/components/agents/plans/plan-agent-console/open-code-usage-section";
import { createI18n } from "@/app/lib/i18n";

import type { OpenCodeUsageTotal } from "@/definition/AgentSessionJournal";

const i18n = createI18n("en");

function render(step: OpenCodeUsageTotal, run: OpenCodeUsageTotal): string {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <OpenCodeUsageSection step={step} run={run} />
    </I18nextProvider>,
  );
}

const step: OpenCodeUsageTotal = {
  messages: 4,
  inputTokens: 9869,
  outputTokens: 252,
  reasoningTokens: 81,
  cacheReadTokens: 25024,
  cacheWriteTokens: 0,
  costUsd: 0,
  costState: "free",
  isIncomplete: false,
  priceAsOf: [],
};

it("shows the native OpenCode step and run totals with free cost", () => {
  const markup = render(
    step,
    {
        ...step,
        messages: 9,
        inputTokens: 20012,
        outputTokens: 560,
        reasoningTokens: 139,
        cacheReadTokens: 58752,
    },
  );
  expect(markup).toContain("Step");
  expect(markup).toContain("Run total");
  expect(markup).toContain("9,869");
  expect(markup).toContain("25,024");
  expect(markup).toContain("20,012");
  expect(markup).toContain("58,752");
  expect(markup.match(/free · \$0\.00/gu)).toHaveLength(2);
});

it("distinguishes missing token reports from an unknown price", () => {
  const markup = render(
    {
        ...step,
        messages: 0,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        costUsd: null,
        costState: "unknown",
        isIncomplete: true,
    },
    step,
  );
  expect(markup.match(/not reported/gu)).toHaveLength(5);
  expect(markup).toContain("price unknown");
  expect(markup).toContain("Step · incomplete");
});
