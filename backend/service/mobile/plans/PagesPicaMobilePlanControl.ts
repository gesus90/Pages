import { randomUUID } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { canRunPlan } from "@/definition/AgentPlanTeam";
import { PICA_MOBILE_ERROR_CODE } from "@/definition/PicaMobileProtocol";

import { toPicaMobileRunStatus } from "../PicaMobileRunMapping";
import { readCurrentSessionUser } from "../PicaMobileSessionUser";

import type { AuthService } from "@/backend/auth/AuthService";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentPlanCommandOperations } from "@/backend/service/agents/AgentPlanCommandOperations";
import type { AgentPlanOverviewService } from "@/backend/service/agents/AgentPlanOverview";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanCommandOperation } from "@/definition/AgentPlanOperations";
import type { PicaMobilePlanRunControlPayload } from "@/definition/PicaMobilePlanControl";
import type {
  PicaMobileErrorCode,
  PicaMobilePlanRunAction,
} from "@/definition/PicaMobileProtocol";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type {
  PicaMobilePlanControl,
  PicaMobilePlanControlOutcome,
} from "./PicaMobilePlansProvider";

/** The Pages services a run action goes through; the plan page uses the same ones. */
export interface PicaMobilePlanControlServices {
  readonly authService: Pick<AuthService, "getAuthenticatedUser">;
  readonly agentPlanOverviewService: Pick<AgentPlanOverviewService, "readPlan">;
  readonly agentPlanService: Pick<AgentPlanService, "view" | "run" | "control">;
  readonly agentPlanCommands: Pick<AgentPlanCommandOperations, "write">;
}

type Refusal = Extract<PicaMobilePlanControlOutcome, { kind: "refused" }>;

type ServicesResolver = () => Promise<PicaMobilePlanControlServices>;

/** The command of the plan page behind each action; `plans.play` is none of them. */
const OPERATIONS = {
  pause: "plans.pause",
  resume: "plans.resume",
  stop: "plans.stop",
} as const satisfies Record<PicaMobilePlanRunAction, AgentPlanCommandOperation>;

/** The button state of the plan page that offers each action. */
const OFFERS: Readonly<
  Record<
    PicaMobilePlanRunAction,
    keyof Pick<AgentPlanControl, "canPause" | "canResume" | "canStop">
  >
> = { pause: "canPause", resume: "canResume", stop: "canStop" };

/** Refusals of the run commands that mean the run cannot take the action now. */
const STATE_ERRORS: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>([
  "plan_run_unavailable",
  "plan_context_changed",
  "plan_continuation_deleted",
  "plan_running",
  "plan_pause_required",
  "plan_resources_held",
  "plan_workspace_conflict",
  "plan_script_approval_required",
]);

/** The refusals of the shared command service, in the codes of the protocol. */
const OPERATION_REFUSALS: Readonly<
  Partial<Record<AgentOperationError["code"], PicaMobileErrorCode>>
> = {
  FORBIDDEN: PICA_MOBILE_ERROR_CODE.FORBIDDEN,
  NOT_FOUND: PICA_MOBILE_ERROR_CODE.NOT_FOUND,
  CONFLICT: PICA_MOBILE_ERROR_CODE.CONFLICT,
  INVALID_REQUEST: PICA_MOBILE_ERROR_CODE.INVALID_REQUEST,
};

function refuse(code: PicaMobileErrorCode, message: string): Refusal {
  return { kind: "refused", code, message };
}

const NOT_FOUND = refuse(
  PICA_MOBILE_ERROR_CODE.NOT_FOUND,
  "The run does not exist or is not visible to the account.",
);

/** Translates a refusal of the plan services; `null` for a failure of Pages itself. */
function translateCommandError(error: unknown): Refusal | null {
  if (error instanceof AgentOperationError) {
    const code = OPERATION_REFUSALS[error.code];

    return code === undefined
      ? null
      : refuse(code, "The plan service refused the action.");
  }

  if (!(error instanceof AgentError)) return null;

  if (error.code === "plan_access_denied") {
    return refuse(
      PICA_MOBILE_ERROR_CODE.FORBIDDEN,
      "The account may not control this run.",
    );
  }

  return STATE_ERRORS.has(error.code)
    ? refuse(
        PICA_MOBILE_ERROR_CODE.INVALID_REQUEST,
        `The run cannot take this action now (${error.code}).`,
      )
    : null;
}

/**
 * Refuses a run that is not the latest own run of the plan: a readable run
 * of another person is `forbidden`, everything else `not_found`.
 */
async function refuseOtherRun(
  services: PicaMobilePlanControlServices,
  userId: string,
  request: PicaMobilePlanRunControlPayload,
): Promise<Refusal> {
  try {
    const run = await services.agentPlanService.run(userId, request.runId);

    return run.planId === request.planId && run.userId !== userId
      ? refuse(
          PICA_MOBILE_ERROR_CODE.FORBIDDEN,
          "The run belongs to another person.",
        )
      : NOT_FOUND;
  } catch (error: unknown) {
    // A missing run and a run the account may not read look the same.
    if (error instanceof AgentError) return NOT_FOUND;
    throw error;
  }
}

/**
 * Checks a request in the order visibility, right, revision and state.
 * @returns The refusal, or `null` when the plan page offers the action now.
 */
async function checkRequest(
  services: PicaMobilePlanControlServices,
  userId: string,
  request: PicaMobilePlanRunControlPayload,
): Promise<Refusal | null> {
  const plan = await services.agentPlanOverviewService.readPlan(
    userId,
    request.planId,
  );

  if (plan.kind === "gone") return NOT_FOUND;

  const own = plan.run;

  if (own === null || own.run.id !== request.runId) {
    return refuseOtherRun(services, userId, request);
  }

  const view = await services.agentPlanService.view(userId, request.planId);

  if (!canRunPlan(view)) {
    return refuse(
      PICA_MOBILE_ERROR_CODE.FORBIDDEN,
      "The account may not run this plan.",
    );
  }

  if (own.revision !== request.expectedRevision) {
    return {
      ...refuse(
        PICA_MOBILE_ERROR_CODE.CONFLICT,
        "The run changed since the named revision; read it again.",
      ),
      ...(own.revision === undefined ? {} : { currentRevision: own.revision }),
    };
  }

  const control = await services.agentPlanService.control(
    userId,
    request.planId,
  );

  if (control.runId === request.runId && control[OFFERS[request.action]]) {
    return null;
  }

  return refuse(
    PICA_MOBILE_ERROR_CODE.INVALID_REQUEST,
    `The run is ${toPicaMobileRunStatus(own.run.status)}; "${request.action}" does not fit its state now.`,
  );
}

/** Reads the run as it is after the action, for `plan_run_controlled`. */
async function readControlled(
  services: PicaMobilePlanControlServices,
  userId: string,
  request: PicaMobilePlanRunControlPayload,
): Promise<PicaMobilePlanControlOutcome> {
  const plan = await services.agentPlanOverviewService.readPlan(
    userId,
    request.planId,
  );
  const entry = plan.kind === "ok" ? plan.run : null;

  if (entry === null) {
    // Only a right lost in the same moment hides the run after its action.
    throw new Error("The controlled run is no longer readable.");
  }

  return {
    kind: "controlled",
    payload: {
      planId: request.planId,
      runId: entry.run.id,
      action: request.action,
      status: toPicaMobileRunStatus(entry.run.status),
      canResume: entry.canResume,
      revision: entry.revision ?? 0,
    },
  };
}

/**
 * Pauses, resumes and stops own runs for Pica Mobile (`plans.control.v1`).
 * @remarks
 * Every request starts from the account the session belongs to right now.
 * Only the latest own run of a plan, the one `plans` and `plan_get` show,
 * can be controlled, and only while the plan page offers the action for it:
 * the same right to run the plan, the same button state and the same
 * command service as the plan page. A run of another person is
 * `forbidden` when the account may read it and `not_found` otherwise; a
 * revision other than the run's current one is a `conflict`, an action
 * that does not fit the state `invalid_request`. A refused request changes
 * nothing. Starting a plan is no action of this contract.
 */
export class PagesPicaMobilePlanControl implements PicaMobilePlanControl {
  private readonly resolveServices: ServicesResolver;

  /**
   * Creates the run control.
   * @param resolveServices - Resolves the Pages services when a request
   * needs them, so the listener works before the database does.
   */
  public constructor(resolveServices: ServicesResolver) {
    this.resolveServices = resolveServices;
  }

  /**
   * Applies one action to one own run of the account behind the session.
   * @param session - The account and session of the connection.
   * @param request - The checked payload of `plan_run_control`.
   * @returns The run after the action, the refusal, or the ended session.
   */
  public async control(
    session: PicaMobileSessionIdentity,
    request: PicaMobilePlanRunControlPayload,
  ): Promise<PicaMobilePlanControlOutcome> {
    const services = await this.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);

    if (user === null) {
      return { kind: "sessionEnded" };
    }

    try {
      const refusal = await checkRequest(services, user.id, request);

      if (refusal !== null) return refusal;

      await services.agentPlanCommands.write(
        user.id,
        OPERATIONS[request.action],
        {
          operationId: randomUUID(),
          planId: request.planId,
          runId: request.runId,
        },
      );
    } catch (error: unknown) {
      const refusal = translateCommandError(error);

      if (refusal === null) throw error;

      return refusal;
    }

    return readControlled(services, user.id, request);
  }
}
