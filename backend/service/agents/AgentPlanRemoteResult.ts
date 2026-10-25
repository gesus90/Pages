import { agentRunOptionsFor } from "@/definition/AgentConfiguration";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanNode } from "@/backend/agents/AgentPlanInput";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { buildPlanContract } from "./AgentPlanContract";
import { evaluatePlanAcceptance } from "./AgentPlanAcceptance";
import type { RemotePlanStep } from "./AgentPlanRemoteExecution";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerExecution } from "@/definition/RunnerExecution";

/** Builds CLI diagnostics in the event transaction, before immutable completion is checkpointed. */
export function recordRemoteAgentResult(
  snapshot: unknown,
  command: RunnerExecution | undefined,
  result: AgentPlanStepResult,
): AgentPlanStepResult {
  if (command?.program.kind !== "cli") return result;
  const target = result.execution?.target;
  if (target?.kind !== "remote")
    throw new Error("Remote CLI execution missing");
  const basis = readAgentObject(snapshot);
  const entries: readonly unknown[] = Array.isArray(basis.remoteSteps)
    ? basis.remoteSteps
    : [];
  const pinned = entries.find(
    (entry) => readAgentObject(readAgentObject(entry).step).id === result.id,
  );
  const step = readPlanNode(readAgentObject(pinned).step);
  if (step.type !== "agent") throw new Error("Remote CLI node missing");
  return remoteAgentResult({ step, target, command }, result);
}

/** Stores the ordinary diagnostic report for a one-shot remote CLI session. */
function remoteAgentResult(
  remote: Pick<RemotePlanStep, "step" | "target" | "command">,
  result: AgentPlanStepResult,
): AgentPlanStepResult {
  const progress = result.remote;
  if (!progress) return result;
  const node = remote.step;
  const program = remote.command.program;
  if (node.type !== "agent" || program.kind !== "cli") return result;
  const runner = program.route.tool === "codex" ? "codex_cli" : "claude_code";
  const options = agentRunOptionsFor(runner, node.configuration?.template.run);
  const contract = buildPlanContract(node.instruction, [], {
    isReadOnly: options.access === "read_only",
    completion: node.completion,
  });
  const acceptance = evaluatePlanAcceptance(contract, result.output ?? "", {
    checked: new Map(),
    unreadable: [],
    changed: [],
    isCheckRequired: false,
  });
  return {
    ...result,
    session: {
      runner,
      mode: "one_shot",
      instanceId: progress.jobId,
      attemptId: result.execution?.attemptId,
      dispatchedPromptDigest: planContentDigest(program.prompt),
      sessionId: progress.sessionId,
      processId: null,
      startedAt: progress.startedAt,
      turnEndedAt: progress.endedAt,
      endedAt: progress.endedAt,
      exit: {
        code: progress.exitCode ?? null,
        signal: progress.signal ?? null,
      },
      closeout: progress.closeout,
      leftoverProcesses: null,
      resultCode: remoteResultCode(result),
      requested: {
        runner,
        connectionId: remote.target.connectionId,
        connectionName: remote.target.connectionName,
        model: program.model,
        reasoningEffort: program.reasoningEffort,
        options,
        unattended: program.access,
        mcp: remote.command.pagesAccess === 1,
        directory: remote.target.path,
      },
      effective: null,
      definition: null,
      contract,
      acceptance,
      events: [],
    },
  };
}

function remoteResultCode(result: AgentPlanStepResult): 0 | -1 | null {
  if (result.status === "succeeded") return 0;
  return result.status === "failed" || result.status === "cancelled"
    ? -1
    : null;
}
