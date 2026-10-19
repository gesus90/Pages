import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { planDepartments, soleDepartment } from "./AgentPlanOwnership";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";

interface LegacyShareDependencies {
  readonly plans: Pick<
    AgentPlanRepository,
    "listLegacyShareCandidates" | "shareLegacyPlan" | "releaseLegacyShare"
  >;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
}

/** How many marked plans each rule decided; the log carries these counts and nothing else. */
export interface LegacyShareCounts {
  /** Plans that were marked when the run began. */
  readonly candidates: number;
  /** Plans that now belong to the department of their owner. */
  readonly shared: number;
  /** Plans whose owner is neither member nor leader of a department yet (or is inactive); they stay marked for the next start. */
  readonly deferred: number;
  /** Plans whose owner belongs to several distinct departments; they stay private and lose the mark. */
  readonly multiple: number;
  /** Plans whose name the department already uses in the project; they stay private and lose the mark. */
  readonly collided: number;
}

const NO_COUNTS: LegacyShareCounts = {
  candidates: 0,
  shared: 0,
  deferred: 0,
  multiple: 0,
  collided: 0,
};

/**
 * Shares the plans that existed before teams with the team of their owner, once.
 *
 * @remarks
 * Migration 062 marked every plan it found. This runs at each server start and
 * decides each marked plan with the rule that applies when a plan is created:
 * - an owner who now belongs to exactly one department brings the plan into
 *   that department (department and name key; owner, revision, content, runs
 *   and the recorded editor stay as they are) and the mark is dropped. Being
 *   a member and leading the same department is one department;
 * - an owner without a department, or an inactive or unknown one, keeps the
 *   plan marked, so a later start tries again once the owner has joined or
 *   leads one;
 * - an owner with several distinct departments keeps the plan private and the
 *   mark is dropped, because no department is guessed;
 * - a plan whose normalized name the department already uses in the project
 *   stays private and loses the mark. Nothing is renamed, merged or deleted.
 *
 * Plans are decided by ascending identifier. Among legacy plans of one
 * project that would take the same name in the same department, the smallest
 * identifier is decided first and wins; the others collide. Plan identifiers
 * are random, so "oldest" cannot be derived (no creation time is stored); the
 * rule is only reproducible, never a judgement about which plan matters more.
 *
 * Plans created after the migration are never marked, so a later private plan
 * is not published. A failure is logged and never stops the server from
 * starting; the plans not decided yet stay marked.
 *
 * @returns The counts, which are also logged (one event per outcome with
 * `kind` and `count`) without any name or person.
 */
export async function shareLegacyPlans(
  dependencies: LegacyShareDependencies,
): Promise<LegacyShareCounts> {
  try {
    return await decide(dependencies);
  } catch (error: unknown) {
    logCaughtError("AgentPlanLegacyShare", error);

    logEvent({
      level: "warn",
      event: "agent_plans.legacy_share.failed",
      component: "AgentPlanLegacyShare",
      message:
        "Sharing the plans of before teams failed; the marked plans stay as they are.",
    });
    return NO_COUNTS;
  }
}

async function decide(
  dependencies: LegacyShareDependencies,
): Promise<LegacyShareCounts> {
  const candidates = await dependencies.plans.listLegacyShareCandidates();
  if (candidates.length === 0) return NO_COUNTS;
  const departments = new Map(
    (await dependencies.authorization.snapshot()).accounts.map((account) => [
      account.userId,
      account.isActive ? planDepartments(account) : [],
    ]),
  );
  let shared = 0;
  let deferred = 0;
  let multiple = 0;
  let collided = 0;
  for (const candidate of candidates) {
    const memberships = departments.get(candidate.ownerId) ?? [];
    const department = soleDepartment(memberships);
    if (memberships.length === 0) deferred += 1;
    else if (department === null) {
      await dependencies.plans.releaseLegacyShare(candidate.id);
      multiple += 1;
    } else if (
      (await dependencies.plans.shareLegacyPlan(candidate.id, department)) ===
      "shared"
    )
      shared += 1;
    else collided += 1;
  }
  const counts = {
    candidates: candidates.length,
    shared,
    deferred,
    multiple,
    collided,
  };
  logCounts(counts);
  return counts;
}

/** Logs one event per outcome that occurred, with the number of plans and nothing else. */
function logCounts(counts: LegacyShareCounts): void {
  const outcomes = {
    shared: counts.shared,
    deferred: counts.deferred,
    multiple: counts.multiple,
    collided: counts.collided,
  };
  for (const [kind, count] of Object.entries(outcomes))
    if (count > 0)
      logEvent({
        level: "info",
        event: "agent_plans.legacy_share.decided",
        component: "AgentPlanLegacyShare",
        message: "Plans of before teams were decided for sharing with a team.",
        metadata: { kind, count },
      });
}
