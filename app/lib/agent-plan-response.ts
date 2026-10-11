import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Route actions expose stable errors and sanitized views, never execution snapshots. */
export type AgentPlanActionResult =
  | {
      readonly ok: true;
      readonly intent: string;
      readonly planId?: string;
      readonly run?: AgentPlanRun;
    }
  | {
      readonly ok: false;
      readonly intent: string;
      readonly error: string;
      readonly runId?: string;
    };
