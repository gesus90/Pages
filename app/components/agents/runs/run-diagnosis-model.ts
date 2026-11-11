import {
  AGENT_RUN_ERROR_CLASSES,
  AGENT_RUN_LIST_STATUSES,
} from "@/definition/AgentRunDiagnosis";

import type {
  AgentRunErrorClass,
  AgentRunFailureSummary,
  AgentRunList,
  AgentRunLogPage,
  AgentRunStarter,
  AgentRunTimeline,
} from "@/definition/AgentRunDiagnosis";
import type { AgentPlanRunDetail } from "@/definition/AgentPlanOperations";

/** The endpoint that answers the run view with the rights of the signed-in person. */
export const RUN_DIAGNOSIS_ENDPOINT = "/agent-api/run-diagnosis";

/** The plans of the filters and the signed-in person. */
export interface RunDiagnosisPlans {
  readonly userId: string;
  readonly plans: readonly {
    readonly id: string;
    readonly name: string;
    readonly projectId: string;
    readonly projectName: string;
  }[];
}

/** One run with the facts the run view shows. */
export interface RunDiagnosisRun {
  readonly run: AgentPlanRunDetail;
  readonly startedBy: AgentRunStarter;
  readonly hiddenFields: readonly string[];
  readonly isStarter: boolean;
}

/** What the filters narrow the runs and failures to. */
export interface RunFilters {
  readonly planId: string;
  readonly status: string;
  readonly errorClass: string;
  readonly stepId: string;
  readonly startedById: string;
  readonly from: string;
  readonly to: string;
}

export const EMPTY_RUN_FILTERS: RunFilters = {
  planId: "",
  status: "",
  errorClass: "",
  stepId: "",
  startedById: "",
  from: "",
  to: "",
};

/** The answers of the endpoint by view. */
export interface RunDiagnosisAnswers {
  readonly plans: RunDiagnosisPlans;
  readonly runs: AgentRunList;
  readonly failures: AgentRunFailureSummary;
  readonly run: RunDiagnosisRun;
  readonly timeline: AgentRunTimeline;
  readonly logs: AgentRunLogPage;
}

export const ERROR_CLASSES: readonly AgentRunErrorClass[] =
  AGENT_RUN_ERROR_CLASSES;
export const RUN_STATUSES = AGENT_RUN_LIST_STATUSES;

/** The query of a view: only the filters that are set, the date inputs as ISO times. */
export function filterQuery(
  filters: RunFilters,
  names: readonly (keyof RunFilters)[],
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const name of names) {
    const value = filters[name];
    if (value === "") continue;
    query[name] =
      name === "from" || name === "to"
        ? new Date(
            name === "to" ? `${value}T23:59:59.999` : value,
          ).toISOString()
        : value;
  }
  return query;
}

/** Tells a started run from one that is over. */
export function isOpenStatus(status: string): boolean {
  return (
    status === "running" ||
    status === "pausing" ||
    status === "paused" ||
    status === "stopping"
  );
}
