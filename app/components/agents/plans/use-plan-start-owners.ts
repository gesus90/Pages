import { useState } from "react";

import { planStartOwnerSchema } from "@/definition/AgentPlanResourceRelease";

import type { AgentPlanStartOwner } from "@/definition/AgentPlanResourceRelease";

/** Reads the current affected owners when Starten is clicked, before showing its confirmation. */
export function usePlanStartOwners(planId: string | undefined, revision: number | undefined): {
  readonly owners: readonly AgentPlanStartOwner[];
  readonly isPending: boolean;
  readonly error: string | null;
  readonly inspect: () => Promise<readonly AgentPlanStartOwner[] | null>;
} {
  const [owners, setOwners] = useState<readonly AgentPlanStartOwner[]>([]);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function inspect(): Promise<readonly AgentPlanStartOwner[] | null> {
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("intent", "inspect-plan-start");
      body.set("planId", planId ?? "");
      body.set("revision", String(revision ?? ""));
      const response = await fetch("/agents/plans", { method: "POST", body, cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok || typeof payload !== "object" || payload === null || !("owners" in payload))
        throw new Error("Start owners unavailable");
      const current = planStartOwnerSchema.array().parse(payload.owners);
      setOwners(current);
      return current;
    } catch {
      setError("plan_run_unavailable");
      return null;
    } finally {
      setPending(false);
    }
  }
  return { owners, isPending, error, inspect };
}
