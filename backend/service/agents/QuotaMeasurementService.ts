import {
  FIXED_QUOTA_MINUTES,
  projectQuota,
  quotaLookback,
  quotaWindowTiming,
} from "@/definition/QuotaForecast";
import { zaiWindowDurationMinutes } from "@/definition/ZaiQuota";

import type {
  MeasuredQuotaWindows,
  QuotaMeasurementRepository,
  QuotaSeries,
} from "@/backend/database/repositories/agent/QuotaMeasurementRepository";
import type { QuotaAccount, QuotaSnapshot } from "@/definition/AgentQuota";
import type {
  AntigravityQuotaGroup,
  AntigravityQuotaWindow,
} from "@/definition/AntigravityQuota";
import type { ClaudeQuotaWindow } from "@/definition/ClaudeQuota";
import type { CodexQuotaWindow } from "@/definition/CodexQuota";
import type { QuotaFrame, QuotaPace } from "@/definition/QuotaForecast";
import type { ZaiQuotaReading, ZaiQuotaWindow } from "@/definition/ZaiQuota";

interface WindowReading extends QuotaFrame {
  readonly key: string;
  readonly used: number;
}

type ProviderReading =
  | {
      readonly provider: "claude_code";
      readonly windows: readonly ClaudeQuotaWindow[];
    }
  | {
      readonly provider: "codex_cli";
      readonly windows: readonly CodexQuotaWindow[];
    }
  | {
      readonly provider: "antigravity";
      readonly groups: readonly AntigravityQuotaGroup[];
    }
  | ({ readonly provider: "zai" } & ZaiQuotaReading);

interface MeasurementInput {
  readonly connectionId: string;
  readonly credentialRevision: string | null;
  readonly at: string;
  readonly reading: ProviderReading;
}

function claudeReading(window: ClaudeQuotaWindow): WindowReading {
  return {
    key: window.kind,
    used: window.usedPercentage,
    resetsAt: window.resetsAt,
    durationMinutes: FIXED_QUOTA_MINUTES[window.kind],
  };
}

function codexReading(window: CodexQuotaWindow): WindowReading {
  return { ...window, key: window.kind, used: window.usedPercent };
}

function antigravityReading(
  window: AntigravityQuotaWindow,
  group: string,
): WindowReading {
  return {
    key: JSON.stringify([group, window.kind]),
    used: (1 - window.remainingFraction) * 100,
    resetsAt: window.resetsAt,
    durationMinutes: FIXED_QUOTA_MINUTES[window.kind],
  };
}

function zaiReading(window: ZaiQuotaWindow): WindowReading {
  return {
    key: JSON.stringify([
      window.kind,
      window.length?.unit,
      window.length?.count,
    ]),
    used: window.usedPercent,
    resetsAt: window.resetsAt,
    durationMinutes: zaiWindowDurationMinutes(window),
  };
}

function windowReadings(reading: ProviderReading): WindowReading[] {
  switch (reading.provider) {
    case "claude_code":
      return reading.windows.map(claudeReading);
    case "codex_cli":
      return reading.windows.map(codexReading);
    case "antigravity":
      return reading.groups.flatMap((group) =>
        group.windows.map((window) => antigravityReading(window, group.name)),
      );
    case "zai":
      return reading.windows.map(zaiReading);
  }
}

function measureRate(
  points: QuotaSeries["points"],
  lookback: number,
): number | null {
  const first = points[0];
  const last = points.at(-1);
  if (points.length < 3 || !last) return null;
  const elapsed = last[0] - first[0];
  return elapsed >= lookback / 3 ? (last[1] - first[1]) / elapsed : null;
}

function continuesWindow(
  reading: WindowReading,
  previous: QuotaSeries,
): boolean {
  return (
    previous.resetsAt === reading.resetsAt &&
    previous.durationMinutes === reading.durationMinutes &&
    reading.used >= previous.used
  );
}

function projectsDepletion(
  remaining: number,
  rate: number | null,
  untilReset: number,
  wasDepleting: boolean,
): boolean {
  if (rate === null || rate <= 0 || remaining <= 0) return false;
  return projectQuota(remaining, rate, untilReset, wasDepleting).isDepleting;
}

function observedWindowTiming(
  reading: WindowReading,
  observedAt: number,
): {
  readonly reset: number;
  readonly duration: number;
  readonly resetsAt: string;
  readonly durationMinutes: number;
} | null {
  const timing = quotaWindowTiming(reading);
  const { resetsAt, durationMinutes } = reading;
  if (!timing || resetsAt === null || durationMinutes === null) return null;
  if (observedAt >= timing.reset || observedAt < timing.reset - timing.duration)
    return null;
  return { ...timing, resetsAt, durationMinutes };
}

function measureWindow(
  reading: WindowReading,
  observedAt: number,
  previous: QuotaSeries | undefined,
): QuotaSeries | null {
  const timing = observedWindowTiming(reading, observedAt);
  if (!timing) return null;
  const { used } = reading;
  const { reset, duration, resetsAt, durationMinutes } = timing;
  const hasReset =
    previous !== undefined && !continuesWindow(reading, previous);
  const lookback = quotaLookback(duration);
  const priorPoints = hasReset ? [] : (previous?.points ?? []);
  const points: QuotaSeries["points"] = [
    ...priorPoints.filter(([at]) => at >= observedAt - lookback),
    [observedAt, used],
  ];
  const rate = measureRate(points, lookback);
  const previousPace = hasReset ? undefined : previous?.pace;
  const wasDepleting =
    previousPace?.wasDepleting === true &&
    observedAt - previousPace.measuredAt <= lookback;
  return {
    resetsAt,
    durationMinutes,
    used,
    points,
    pace: {
      measuredAt: observedAt,
      rate,
      isNewWindow:
        rate === null && (hasReset || previousPace?.isNewWindow === true),
      wasDepleting: projectsDepletion(
        100 - used,
        rate,
        reset - observedAt,
        wasDepleting,
      ),
    },
  };
}

function measureWindows(
  readings: readonly WindowReading[],
  at: number,
  previous: Readonly<Record<string, QuotaSeries>>,
): Record<string, QuotaSeries> {
  // Keep an absent window briefly so a reset is still recognized when it returns.
  const measured = new Map(
    Object.entries(previous).filter(
      ([, window]) =>
        Date.parse(window.resetsAt) +
          quotaLookback(window.durationMinutes * 60_000) >=
        at,
    ),
  );
  const seen = new Set<string>();
  for (const reading of readings) {
    if (seen.has(reading.key)) {
      measured.delete(reading.key);
      continue;
    }
    seen.add(reading.key);
    const window = measureWindow(reading, at, previous[reading.key]);
    if (window) measured.set(reading.key, window);
  }
  return Object.fromEntries(measured);
}

function withPace<Window extends { readonly pace?: QuotaPace }>(
  window: Window,
  reading: WindowReading,
  measured: MeasuredQuotaWindows,
): Window {
  const latest = measured[reading.key];
  if (
    !latest ||
    latest.resetsAt !== reading.resetsAt ||
    latest.durationMinutes !== reading.durationMinutes ||
    latest.used !== reading.used
  )
    return window;
  return { ...window, pace: latest.pace };
}

function cardWithPace(
  card: QuotaAccount,
  measured: MeasuredQuotaWindows,
): QuotaAccount {
  switch (card.provider) {
    case "claude_code":
      return {
        ...card,
        windows: card.windows.map((window) =>
          withPace(window, claudeReading(window), measured),
        ),
      };
    case "codex_cli":
      return {
        ...card,
        windows: card.windows.map((window) =>
          withPace(window, codexReading(window), measured),
        ),
      };
    case "antigravity":
      return {
        ...card,
        groups: card.groups.map((group) => ({
          ...group,
          windows: group.windows.map((window) =>
            withPace(window, antigravityReading(window, group.name), measured),
          ),
        })),
      };
    case "zai":
      return {
        ...card,
        windows: card.windows.map((window) =>
          withPace(window, zaiReading(window), measured),
        ),
      };
    case "openrouter":
      return card;
  }
}

/** Keeps quota history and attaches only the rate and state used by each card. */
export class QuotaMeasurementService {
  private readonly repository: QuotaMeasurementRepository;

  public constructor(repository: QuotaMeasurementRepository) {
    this.repository = repository;
  }

  /** Records one successful provider response; shared requests reuse that result. */
  public async record(measurement: MeasurementInput): Promise<void> {
    const { connectionId, at, credentialRevision, reading } = measurement;
    const observedAt = Date.parse(at);
    const readings = windowReadings(reading);
    await this.repository.update(connectionId, observedAt, (previous) => ({
      credentialRevision,
      zaiReading:
        reading.provider === "zai"
          ? {
              executionLocation: reading.executionLocation,
              plan: reading.plan,
              windows: reading.windows,
              tally: reading.tally,
              entries: reading.entries,
            }
          : undefined,
      windows: measureWindows(
        readings,
        observedAt,
        previous && previous.credentialRevision === credentialRevision
          ? previous.windows
          : {},
      ),
    }));
  }

  /** Reads the last usable answer for the current Z.AI key. */
  public readZaiReading(
    connectionId: string,
    revision: string,
  ): ReturnType<QuotaMeasurementRepository["readZaiReading"]> {
    return this.repository.readZaiReading(connectionId, revision);
  }

  /** Invalidates the displayed figures when Z.AI rejects a key. */
  public clearZaiReading(
    connectionId: string,
    revision: string,
  ): Promise<void> {
    return this.repository.clearZaiReading(connectionId, revision);
  }

  /** Adds forecast inputs only to windows that match their stored measurement. */
  public async addPace(snapshot: QuotaSnapshot): Promise<QuotaSnapshot> {
    const ids = snapshot.accounts
      .filter(
        (card) =>
          card.provider !== "openrouter" && card.status.kind !== "signed_out",
      )
      .map((card) => card.connectionId);
    const measured = await this.repository.read(ids);
    return {
      ...snapshot,
      accounts: snapshot.accounts.map((card) =>
        cardWithPace(card, measured.get(card.connectionId) ?? {}),
      ),
    };
  }
}
