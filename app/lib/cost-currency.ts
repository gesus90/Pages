import type { EuroDollarReferenceRate } from "@/definition/AgentSessionPricing";
import type { UserCurrency } from "@/definition/Settings";

/**
 * A cost keeps up to four decimals, so a cent fraction of a short session
 * stays visible.
 */
const COST_FRACTION_DIGITS = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
} as const;

/** An amount in the currency it was reported or estimated in. */
export interface CostAmount {
  readonly amount: number;
  /** ISO 4217 code, such as `USD`. */
  readonly currency: string;
}

/** The rate a conversion used: one unit of `from` is worth `factor` units of `to`. */
export interface CostConversionRate {
  readonly from: UserCurrency;
  readonly to: UserCurrency;
  readonly factor: number;
  /** The ECB working day of the rate, `YYYY-MM-DD`. */
  readonly date: string;
}

/**
 * A cost as shown in the currency the user chose.
 * - `original`: already in the chosen currency, shown as it is.
 * - `converted`: converted with the ECB reference rate; the original stays
 *   with it for the hint.
 * - `unconverted`: no valid rate for the pair, so the original amount stands
 *   with its currency code.
 */
export type DisplayedCost =
  | { readonly kind: "original"; readonly original: CostAmount }
  | {
      readonly kind: "converted";
      readonly original: CostAmount;
      readonly shown: CostAmount;
      readonly rate: CostConversionRate;
    }
  | { readonly kind: "unconverted"; readonly original: CostAmount };

/** How a formatted cost names its currency: `0,42 $` or `0,42 USD`. */
type CostCurrencyDisplay = "symbol" | "code";

/** The rate between US dollar and euro, or `null` for another pair or without a valid rate. */
function conversionRate(
  from: string,
  to: UserCurrency,
  rate: EuroDollarReferenceRate | null,
): CostConversionRate | null {
  if (!rate || !Number.isFinite(rate.usdPerEur) || rate.usdPerEur <= 0)
    return null;
  if (from === "USD" && to === "EUR")
    return { from, to, factor: 1 / rate.usdPerEur, date: rate.date };
  if (from === "EUR" && to === "USD")
    return { from, to, factor: rate.usdPerEur, date: rate.date };
  return null;
}

/**
 * Shows a cost in the chosen currency.
 * @param original - The amount in the currency it was reported or estimated in.
 * @param currency - The currency the user chose for costs.
 * @param rate - The last valid ECB rate, or `null` without one.
 * @remarks
 * Only the display changes: the original amount and currency stay with the
 * result. A reported 0 stays 0 in every currency. Without a valid rate the
 * original amount stands, never an assumed rate.
 */
export function displayCost(
  original: CostAmount,
  currency: UserCurrency,
  rate: EuroDollarReferenceRate | null,
): DisplayedCost {
  if (original.currency === currency) return { kind: "original", original };
  const conversion = conversionRate(original.currency, currency, rate);
  if (!conversion || !rate) return { kind: "unconverted", original };
  // The ECB quotes US dollars per euro; dividing keeps its four decimals exact.
  const amount =
    conversion.from === "USD"
      ? original.amount / rate.usdPerEur
      : original.amount * rate.usdPerEur;
  return {
    kind: "converted",
    original,
    shown: { amount, currency },
    rate: conversion,
  };
}

/**
 * Formats a cost in the app language with two to four decimals.
 * @param cost - The amount and its currency.
 * @param language - The app language, such as `de`.
 * @param display - `symbol` for `0,42 $`, `code` for `0,42 USD`.
 */
export function formatCostAmount(
  cost: CostAmount,
  language: string,
  display: CostCurrencyDisplay,
): string {
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency: cost.currency,
    currencyDisplay: display === "symbol" ? "narrowSymbol" : "code",
    ...COST_FRACTION_DIGITS,
  }).format(cost.amount);
}

/**
 * Formats a conversion rate, such as `1 USD = 0,9122 EUR`.
 * @param rate - The rate of the conversion.
 * @param language - The app language, such as `de`.
 */
export function formatConversionRate(
  rate: CostConversionRate,
  language: string,
): string {
  const factor = new Intl.NumberFormat(language, COST_FRACTION_DIGITS).format(
    rate.factor,
  );
  return `1 ${rate.from} = ${factor} ${rate.to}`;
}
