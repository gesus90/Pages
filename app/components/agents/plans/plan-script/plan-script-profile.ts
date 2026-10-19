import type { TFunction } from "i18next";
import type { AgentPlanInterpreter } from "@/definition/AgentPlanScript";

/**
 * Where a script's interpreter profile stands.
 *
 * @remarks
 * `missing` is a profile the server no longer configures; `unknown` means the
 * editor has no profile list yet, before a workspace is chosen.
 */
export type PlanScriptProfileState =
  | {
      readonly kind: "ok" | "error" | "unchecked";
      readonly profile: AgentPlanInterpreter;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "unknown" };

/** How a profile state reads: a status word, a short visible text, a reason and a tone. */
export interface PlanScriptProfileText {
  readonly status: string;
  /** What fits beside the profile on the card: the version or a short reason. */
  readonly short: string;
  readonly reason: string | null;
  readonly tone: "success" | "destructive" | "neutral";
}

/** Finds the profile a script names among the configured ones, never by its label. */
export function planScriptProfileState(
  profileId: string,
  interpreters: readonly AgentPlanInterpreter[] | undefined,
): PlanScriptProfileState {
  if (!interpreters) return { kind: "unknown" };
  const profile = interpreters.find((entry) => entry.id === profileId);
  if (!profile) return { kind: "missing" };
  return { kind: profile.status, profile };
}

/** The words of a profile state; red states always carry their reason. */
export function planScriptProfileText(
  state: PlanScriptProfileState,
  translate: TFunction,
): PlanScriptProfileText {
  const status = translate(`plans.scripts.status.${state.kind}`);
  if (state.kind === "ok")
    return {
      status,
      short: state.profile.version ?? status,
      reason: null,
      tone: "success",
    };
  if (state.kind === "error") {
    const error = state.profile.error ?? "failed";
    return {
      status,
      short: translate(`plans.scripts.reasonShort.${error}`),
      reason: translate(`settings.system.interpreters.errors.${error}`),
      tone: "destructive",
    };
  }
  if (state.kind === "missing")
    return {
      status,
      short: status,
      reason: translate("plans.scripts.missingReason"),
      tone: "destructive",
    };
  return { status, short: status, reason: null, tone: "neutral" };
}
