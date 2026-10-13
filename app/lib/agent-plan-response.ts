import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

/** Route actions expose stable errors and sanitized views, never execution snapshots. */
export type AgentPlanActionResult =
  | {
      readonly ok: true;
      readonly intent: string;
      readonly planId?: string;
      readonly revision?: number;
      readonly run?: AgentPlanRun;
    }
  | {
      readonly ok: false;
      readonly intent: string;
      readonly error: string;
      readonly runId?: string;
      readonly issues?: readonly AgentPlanIssue[];
    };
