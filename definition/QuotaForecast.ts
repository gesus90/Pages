import { z } from "zod";

/** The persisted forecast inputs sent to the card for one reported window. */
export const quotaPaceSchema = z.object({
  measuredAt: z.number().int().nonnegative(),
  rate: z.number().nonnegative().nullable(),
  isNewWindow: z.boolean(),
  wasDepleting: z.boolean(),
});

/** The latest successful observation and rate in percentage points per millisecond. */
export type QuotaPace = z.infer<typeof quotaPaceSchema>;

const MINUTE_MILLISECONDS = 60_000;
const HYSTERESIS_MILLISECONDS = 5 * MINUTE_MILLISECONDS;

/** The duration of a fixed window explicitly identified by the provider protocol. */
export const FIXED_QUOTA_MINUTES = {
  five_hour: 300,
  seven_day: 10_080,
} as const;

/** The frame of a quota window, as identified by provider data. */
export interface QuotaFrame {
  readonly resetsAt: string | null;
  readonly durationMinutes: number | null;
}

/** Converts a reported window to milliseconds, or returns null if its frame is unknown. */
export function quotaWindowTiming(
  frame: QuotaFrame,
): { readonly reset: number; readonly duration: number } | null {
  const reset = Date.parse(frame.resetsAt ?? "");
  const duration = (frame.durationMinutes ?? 0) * MINUTE_MILLISECONDS;
  if (!Number.isFinite(reset) || !Number.isFinite(duration) || duration <= 0)
    return null;
  return { reset, duration };
}

/** The recent portion of each window used to measure the consumption rate. */
export function quotaLookback(duration: number): number {
  return duration / 10;
}

/**
 * Projects the remaining share to the reset. A previously red projection
 * stays red until the projected exhaustion is at least five minutes after reset.
 */
export function projectQuota(
  remaining: number,
  rate: number,
  untilReset: number,
  wasDepleting: boolean,
): {
  readonly isDepleting: boolean;
  readonly timeToEmpty: number;
  readonly restAtReset: number;
} {
  const timeToEmpty = remaining / rate;
  const boundary = untilReset + (wasDepleting ? HYSTERESIS_MILLISECONDS : 0);
  return {
    isDepleting: timeToEmpty < boundary,
    timeToEmpty,
    restAtReset: Math.max(0, remaining - rate * Math.max(0, untilReset)),
  };
}

type QuotaForecastState =
  | { readonly kind: "depleting"; readonly timeToEmpty: number }
  | { readonly kind: "enough"; readonly restAtReset: number }
  | {
      readonly kind:
        | "collecting"
        | "steady"
        | "newWindow"
        | "paused"
        | "unavailable"
        | "hidden";
    };

/** Target, forecast and freshness of one window on the remaining scale. */
export interface QuotaForecast {
  readonly target: number | null;
  readonly forecast: QuotaForecastState;
  readonly isStale: boolean;
}

interface QuotaForecastInput extends QuotaFrame {
  readonly now: number;
  readonly remaining: number;
  readonly isExhausted: boolean;
  readonly isStale: boolean;
  readonly pace?: QuotaPace;
}

function forecastAt(
  input: QuotaForecastInput,
  reset: number,
): QuotaForecastState {
  if (input.isExhausted) return { kind: "hidden" };
  const { pace } = input;
  if (pace?.rate == null)
    return { kind: pace?.isNewWindow ? "newWindow" : "collecting" };
  if (pace.rate === 0) return { kind: "steady" };
  const projection = projectQuota(
    input.remaining,
    pace.rate,
    reset - pace.measuredAt,
    pace.wasDepleting,
  );
  if (projection.isDepleting) {
    // Advance the countdown from the time at which the remaining share was observed.
    return {
      kind: "depleting",
      timeToEmpty: Math.max(
        0,
        Math.round(projection.timeToEmpty - (input.now - pace.measuredAt)),
      ),
    };
  }
  return { kind: "enough", restAtReset: projection.restAtReset };
}

/** Derives the presentation from measured figures and the page clock. */
export function quotaForecast(input: QuotaForecastInput): QuotaForecast {
  const timing = quotaWindowTiming(input);
  const isStale =
    input.isStale ||
    (timing !== null &&
      input.pace !== undefined &&
      input.now - input.pace.measuredAt > quotaLookback(timing.duration));
  if (isStale) {
    return {
      target: null,
      forecast: { kind: input.isExhausted ? "hidden" : "paused" },
      isStale,
    };
  }
  if (timing === null || timing.reset <= input.now) {
    return {
      target: null,
      forecast: { kind: input.isExhausted ? "hidden" : "unavailable" },
      isStale,
    };
  }
  return {
    target: Math.round(
      100 * Math.min(1, (timing.reset - input.now) / timing.duration),
    ),
    forecast: forecastAt(input, timing.reset),
    isStale,
  };
}
