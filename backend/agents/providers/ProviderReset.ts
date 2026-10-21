import { readAgentObject } from "@/backend/agents/AgentPayload";

import type { AgentPlanRetryCode } from "@/definition/AgentPlanRetry";

const SECOND_MILLISECONDS = 1_000;

/** Normalizes epoch seconds or an explicit timezone-bearing timestamp; local clock guesses are refused. */
export function providerResetTimestamp(input: unknown): string | null {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    const milliseconds =
      input < 1_000_000_000_000 ? input * SECOND_MILLISECONDS : input;
    const instant = new Date(milliseconds);
    return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
  }
  if (typeof input !== "string") return null;
  if (/^(?:\d{10}(?:\.\d+)?|\d{13})$/u.test(input))
    return providerResetTimestamp(Number(input));
  if (!/(?:Z|[+-]\d{2}:?\d{2}|GMT)$/u.test(input.trim())) return null;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function durationMilliseconds(input: string): number | null {
  const pattern =
    /([0-9]+(?:\.[0-9]+)?)\s*(milliseconds?|ms|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/giu;
  const units: Readonly<Record<string, number>> = {
    h: 3_600_000,
    m: 60_000,
    s: 1_000,
  };
  let total = 0;
  let end = 0;
  for (const match of input.matchAll(pattern)) {
    if (input.slice(end, match.index).trim()) return null;
    const unit = match[2].toLowerCase();
    const multiplier =
      unit.startsWith("ms") || unit.startsWith("millisecond")
        ? 1
        : units[unit[0]];
    total += Number(match[1]) * multiplier;
    end = match.index + match[0].length;
  }
  return end > 0 && !input.slice(end).trim() && Number.isFinite(total)
    ? total
    : null;
}

function afterDuration(input: string, now: number): string | null {
  const duration = durationMilliseconds(input);
  return duration === null
    ? null
    : providerResetTimestamp((now + duration) / SECOND_MILLISECONDS);
}

/** Reads only explicit reset fields, not arbitrary timestamps in a provider body. */
export function structuredProviderReset(input: unknown): string | null {
  const record = readAgentObject(input);
  const error = readAgentObject(record.error);
  const candidates = [
    record.resetsAt,
    record.resetAt,
    record.reset_at,
    error.resetsAt,
    error.resetAt,
    error.reset_at,
  ];
  const resets = candidates
    .map(providerResetTimestamp)
    .filter((instant): instant is string => instant !== null);
  return resets.sort().at(-1) ?? null;
}

/** Extracts an explicit reset duration or ISO instant from an error, without returning its text. */
export function diagnosticProviderReset(
  input: string,
  now = Date.now(),
): string | null {
  const timestamp =
    /(?:reset(?:s)?(?:\s+at)?|try again at)\s*[:=]?\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/iu.exec(
      input,
    )?.[1];
  if (timestamp) return providerResetTimestamp(timestamp);
  const duration =
    /(?:resets? in|try again in|retry after)\s+((?:\d+(?:\.\d+)?\s*(?:milliseconds?|ms|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*)+)/iu.exec(
      input,
    )?.[1];
  return duration ? afterDuration(duration.trim(), now) : null;
}

/** Uses provider reset headers and structured fields; the latest limit is the safe release time. */
export function httpProviderReset(
  response: Response,
  payload: unknown,
  code: AgentPlanRetryCode,
): string | null {
  const now = Date.now();
  const retryAfter = response.headers.get("retry-after");
  const delay =
    retryAfter !== null && /^\d+(?:\.\d+)?$/u.test(retryAfter)
      ? Number(retryAfter) * SECOND_MILLISECONDS
      : null;
  const resets = [
    structuredProviderReset(payload),
    delay === null
      ? providerResetTimestamp(retryAfter)
      : providerResetTimestamp((now + delay) / SECOND_MILLISECONDS),
  ];
  const headers =
    code === "provider_quota_exhausted"
      ? []
      : [
          "x-ratelimit-reset",
          "x-ratelimit-reset-requests",
          "x-ratelimit-reset-tokens",
          "anthropic-ratelimit-requests-reset",
          "anthropic-ratelimit-tokens-reset",
        ];
  // Request/token-window headers do not prove when an exhausted billing quota resets.
  for (const name of headers) {
    const header = response.headers.get(name);
    if (header)
      resets.push(providerResetTimestamp(header) ?? afterDuration(header, now));
  }
  return (
    resets
      .filter((instant): instant is string => instant !== null)
      .sort()
      .at(-1) ?? null
  );
}
