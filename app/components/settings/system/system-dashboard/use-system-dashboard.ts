import { useEffect, useState } from "react";

import { startVisiblePolling } from "@/app/components/agents/plans/plan-visible-polling";
import { readServiceStatusDetails } from "@/app/lib/service-status";
import {
  SYSTEM_DASHBOARD_PATH,
  systemDashboardSchema,
} from "@/definition/SystemDashboard";

import { appendLoadReading, EMPTY_HISTORY } from "./load-history";
import { readLoadRatios } from "./load-level";

import type { ServiceStatusReading } from "@/app/lib/service-status";
import type { SystemDashboard } from "@/definition/SystemDashboard";
import type { LoadHistory } from "./load-history";

/** A new reading starts this long after the previous one started, once it was answered. */
export const DASHBOARD_POLL_INTERVAL_MS = 2000;
/** A reading that takes longer is given up; the next one follows as usual. */
const REQUEST_TIMEOUT_MS = 10_000;

/** What the dashboard shows: the last measurement, the services and the curves. */
export interface SystemDashboardState {
  /** The last measurement; `null` before the first and after a refusal. */
  readonly dashboard: SystemDashboard | null;
  /** The detailed service status of `pages-core`; `null` before the first answer. */
  readonly services: ServiceStatusReading | null;
  readonly history: LoadHistory;
  /** When the browser received the last measurement; the curves end there. */
  readonly receivedAt: number | null;
  /** When the last reading was answered, whatever its outcome; running times count to it. */
  readonly readAt: number | null;
}

type DashboardReading =
  | { readonly kind: "measured"; readonly dashboard: SystemDashboard }
  | { readonly kind: "denied" }
  | { readonly kind: "failed" };

const INITIAL_STATE: SystemDashboardState = {
  dashboard: null,
  services: null,
  history: EMPTY_HISTORY,
  receivedAt: null,
  readAt: null,
};

async function readSystemDashboard(
  signal: AbortSignal,
): Promise<DashboardReading> {
  try {
    const response = await fetch(SYSTEM_DASHBOARD_PATH, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ]),
    });
    if (response.status === 403) return { kind: "denied" };
    if (!response.ok) return { kind: "failed" };
    const parsed = systemDashboardSchema.safeParse(await response.json());
    return parsed.success
      ? { kind: "measured", dashboard: parsed.data }
      : { kind: "failed" };
  } catch {
    // A lost connection, a timeout or a left page: the next reading asks again.
    return { kind: "failed" };
  }
}

function nextState(
  previous: SystemDashboardState,
  answers: {
    readonly reading: DashboardReading;
    readonly services: ServiceStatusReading;
    readonly wasHidden: boolean;
  },
): SystemDashboardState {
  const { reading, services, wasHidden } = answers;
  const at = Date.now();
  // Without the admin mode nothing of the measurements stays on the page.
  if (reading.kind === "denied")
    return { ...INITIAL_STATE, services, readAt: at };
  if (reading.kind === "failed") return { ...previous, services, readAt: at };
  return {
    dashboard: reading.dashboard,
    services,
    history: appendLoadReading(
      previous.history,
      readLoadRatios(reading.dashboard),
      { at, wasHidden },
    ),
    receivedAt: at,
    readAt: at,
  };
}

/**
 * Reads the system dashboard and the service status every two seconds while the page is visible.
 *
 * @returns The last answers and the curves of this page.
 *
 * @remarks
 * A hidden tab and a left page send nothing; returning reads at once. A
 * reading starts only after the previous one was answered. The curves live
 * in this page only and begin empty after a reload; the time in the
 * background stays a gap.
 */
export function useSystemDashboard(): SystemDashboardState {
  const [state, setState] = useState<SystemDashboardState>(INITIAL_STATE);

  useEffect(() => {
    const controller = new AbortController();
    async function read(wasHidden: boolean): Promise<number | null> {
      const startedAt = Date.now();
      const [reading, services] = await Promise.all([
        readSystemDashboard(controller.signal),
        readServiceStatusDetails(controller.signal),
      ]);
      if (controller.signal.aborted) return null;
      setState((previous) =>
        nextState(previous, { reading, services, wasHidden }),
      );
      return Math.max(0, DASHBOARD_POLL_INTERVAL_MS - (Date.now() - startedAt));
    }
    const stop = startVisiblePolling(read);
    return () => {
      stop();
      controller.abort();
    };
  }, []);

  return state;
}
