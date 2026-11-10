import type { AgentParameter } from "./AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanPosition,
  AgentPlanStepRole,
} from "./AgentPlan";

/** The input that named the ticket of the published commit. */
export const PLAN_GIT_CLOSEOUT_TICKET_INPUT = "ticket";
/** The output following nodes read the earlier result from. */
export const PLAN_GIT_CLOSEOUT_OUTPUT = "result";
/** The time limit a saved node had by default; the notation leaves it out. */
export const PLAN_GIT_CLOSEOUT_DEFAULT_TIMEOUT = 3600;

/**
 * A Git closeout node of an earlier version, kept only so saved plans stay readable.
 *
 * @remarks
 * The dedicated node is no longer supported (PAGE-285): nobody can add one,
 * and a plan that still contains one is refused before Play with the advice to
 * remove it or to replace it with an agent or script step of its own. Its
 * configuration, connections and bindings stay unchanged until someone
 * removes it, so no saved plan loses data and nothing is rewritten or run
 * silently.
 */
export interface AgentPlanGitCloseout extends AgentPlanPosition {
  readonly id: string;
  readonly type: "git_closeout";
  readonly name: string;
  readonly role: AgentPlanStepRole;
  readonly checkCommand: string;
  readonly timeoutSeconds: number;
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** The one input the node had, so its saved ticket binding stays visible and connected. */
export const PLAN_GIT_CLOSEOUT_PARAMETERS: readonly AgentParameter[] = [
  {
    name: PLAN_GIT_CLOSEOUT_TICKET_INPUT,
    type: "ticket",
    description: "",
    isRequired: true,
    defaultValue: null,
  },
];
