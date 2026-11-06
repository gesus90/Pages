import { isAcpProvider } from "@/definition/AgentConfiguration";

import { eventSessionLink } from "./branching/AgentPlanEventSession";
import { planSessionLink } from "./loop/AgentPlanLoopSession";

import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { NodeRun } from "./AgentPlanStepContext";
import type { PreparedPlanStep } from "./AgentPlanStepStart";
import type {
  AgentPlanGroupSessions,
  GroupSessionResume,
} from "./AgentPlanGroupSessions";

/** Binds a new turn to its existing group, loop or event session without changing its ownership. */
export function planSharedSessionLink(
  node: NodeRun,
  prepared: PreparedPlanStep,
  input: {
    readonly groups: AgentPlanGroupSessions;
    readonly key: string;
    readonly resume?: GroupSessionResume;
  },
): Pick<AgentPlanSessionRecord, "group" | "loop" | "event"> {
  const provider = prepared.input.agent.connection.provider;
  if (!isAcpProvider(provider)) return {};
  if (node.receivesEvents)
    return {
      event: eventSessionLink(input.groups, node, {
        key: input.key,
        adapter: provider,
        resume: input.resume,
      }),
    };
  const shared = node.sessionGroup
    ? input.groups.link(
        input.key,
        {
          groupId: node.sessionGroup,
          stepId: node.step.step.id,
          adapter: provider,
        },
        input.resume,
      )
    : null;
  return planSessionLink(node, shared);
}
