import { formatQuotaStand } from "./quota-time";

import type { TFunction } from "i18next";
import type { OpenRouterUsage } from "@/definition/OpenRouterQuota";

/** Formatting shared by the OpenRouter card body and its status line. */
export interface OpenRouterQuotaFormat {
  readonly t: TFunction;
  readonly money: (amount: number) => string;
  readonly time: (at: string) => string;
}

/** Formats USD values and reading times in the interface locale. */
export function openRouterQuotaFormat(
  t: TFunction,
  language: string,
  now: Date,
): OpenRouterQuotaFormat {
  const dollars = new Intl.NumberFormat(language, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  });
  return {
    t,
    money(amount) {
      if (amount > 0 && amount < 0.005) return `< ${dollars.format(0.01)}`;
      return dollars.format(amount === 0 ? 0 : amount);
    },
    time(at) {
      return formatQuotaStand(new Date(at), now, { t, language });
    },
  };
}

/** The share of a positive OpenRouter key limit that is still available. */
export function openRouterLimitShare(reading: OpenRouterUsage): number | null {
  const { limit, remaining } = reading;
  if (typeof limit !== "number" || limit <= 0 || remaining === null)
    return null;
  return Math.min(100, (remaining / limit) * 100);
}
