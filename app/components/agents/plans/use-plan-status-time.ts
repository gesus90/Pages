import { useEffect, useState } from "react";

import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Ticks only active runs; missing historical end times remain unknown after reload. */
export function usePlanStatusTime(run: AgentPlanRun | null): string | null {
  const [now, setNow] = useState<string | null>(null);
  const isActive = run !== null && isActivePlanRun(run.status);
  useEffect(() => {
    if (!isActive) return;
    setNow(new Date().toISOString());
    const timer = window.setInterval(
      () => setNow(new Date().toISOString()),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [isActive, run?.id]);
  return isActive ? now : (run?.endedAt ?? null);
}
