import type { AgentPlanCloneAdjustment } from "@/definition/AgentPlanClone";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

/** Route actions expose stable errors and sanitized views, never execution snapshots. */
export type AgentPlanActionResult =
  | {
      readonly ok: true;
      readonly intent: string;
      readonly adjustments?: readonly AgentPlanCloneAdjustment[];
      readonly planId?: string;
      readonly revision?: number;
      readonly run?: AgentPlanRun;
      readonly control?: AgentPlanControl;
    }
  | {
      readonly ok: false;
      readonly intent: string;
      readonly error: string;
      readonly runId?: string;
      readonly currentRevision?: number;
      readonly issues?: readonly AgentPlanIssue[];
      /** The node a refusal names, such as a skipped script that is enabled again. */
      readonly nodeId?: string;
    };
