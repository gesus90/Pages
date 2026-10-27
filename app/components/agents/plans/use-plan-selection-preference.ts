import { useEffect } from "react";
import { useNavigation } from "react-router";

import { planSelectionCookie } from "@/app/lib/agent-plan-selection";

import type { PlanSelectionPreference } from "@/app/lib/agent-plan-selection";

/** Remembers only a committed, authorized opening; cancelled loader results have no side effects. */
export function usePlanSelectionPreference(
  preference: PlanSelectionPreference,
): void {
  const { state } = useNavigation();
  const { origin, userId, planId, discardedPlanId } = preference;
  useEffect(() => {
    if (state !== "idle" || (!planId && !discardedPlanId)) return;
    let isCurrent = true;
    async function persist(): Promise<void> {
      const cookie = planSelectionCookie({ origin, userId });
      const previous = document.cookie;
      if (!planId && (await cookie.parse(previous)) !== discardedPlanId) return;
      const serialized = await cookie.serialize(planId ?? "", {
        secure: window.location.protocol === "https:",
        ...(planId ? {} : { maxAge: 0, expires: new Date(0) }),
      });
      if (isCurrent && (planId || document.cookie === previous))
        document.cookie = serialized;
    }
    void persist().catch((error: unknown) => {
      console.warn("Pages could not store the last opened plan.", error);
    });
    return () => {
      isCurrent = false;
    };
  }, [origin, userId, planId, discardedPlanId, state]);
}
