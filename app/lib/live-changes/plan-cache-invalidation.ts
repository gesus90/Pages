import { localState } from "@/app/lib/local-state/local-state-store";

/** Forgets plan answers before a rights-checked reload, including aliases of a revoked plan. */
export function invalidatePlanCache(): Promise<void> {
  return localState.removeOutdated(
    (payload) =>
      typeof payload === "object" &&
      payload !== null &&
      "opening" in payload &&
      "selected" in payload &&
      "plans" in payload,
  );
}
