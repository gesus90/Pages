import { sanitizeArtifactText } from "@/backend/service/agents/AgentPlanOutput";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanAcceptance } from "@/definition/AgentPlanSession";
import type { AgentPlanCheckpoint } from "@/definition/AgentPlanRecovery";
import type { AgentPlanRemoteProgress } from "@/definition/AgentPlanExecution";

interface DisplayFilter {
  isFiltered: boolean;
}

function clean(text: string, filter: DisplayFilter): string {
  const safe = sanitizeArtifactText(text);
  if (safe !== text) filter.isFiltered = true;
  return safe;
}

function cleanSession(
  session: AgentPlanSessionRecord,
  filter: DisplayFilter,
): AgentPlanSessionRecord {
  const contract = session.contract;
  const acceptance = session.acceptance;
  return {
    ...session,
    events: session.events.map((entry) => clean(entry, filter)),
    contract: contract
      ? {
          ...contract,
          todos: contract.todos.map((item) => ({
            ...item,
            text: clean(item.text, filter),
          })),
          criteria: contract.criteria.map((item) => ({
            ...item,
            text: clean(item.text, filter),
          })),
        }
      : null,
    acceptance: cleanAcceptance(acceptance, filter),
    effective: session.effective
      ? Object.fromEntries(
          Object.entries(session.effective).map(([key, value]) => [
            key,
            clean(value, filter),
          ]),
        )
      : null,
  };
}

function cleanAcceptance(
  acceptance: AgentPlanAcceptance | null,
  filter: DisplayFilter,
): AgentPlanAcceptance | null {
  if (!acceptance) return null;
  return {
    ...acceptance,
    summary: clean(acceptance.summary, filter),
    decisions: acceptance.decisions.map((entry) => clean(entry, filter)),
    issues: acceptance.issues.map((entry) => clean(entry, filter)),
    criteria: acceptance.criteria.map((item) => ({
      ...item,
      evidence: clean(item.evidence, filter),
    })),
  };
}

function cleanRemote(
  remote: AgentPlanRemoteProgress,
  filter: DisplayFilter,
): AgentPlanRemoteProgress {
  if (remote.stdoutIsFiltered || remote.stderrIsFiltered)
    filter.isFiltered = true;
  return {
    ...remote,
    ...(remote.stdout === undefined
      ? {}
      : { stdout: clean(remote.stdout, filter) }),
    ...(remote.stderr === undefined
      ? {}
      : { stderr: clean(remote.stderr, filter) }),
  };
}

function displayStep(step: AgentPlanStepResult): AgentPlanStepResult {
  const filter: DisplayFilter = { isFiltered: false };
  const output = step.output === null ? null : clean(step.output, filter);
  const script = step.script
    ? {
        ...step.script,
        stdout:
          step.script.stdout === null
            ? null
            : clean(step.script.stdout, filter),
        stderr: clean(step.script.stderr, filter),
      }
    : undefined;
  const remote = step.remote ? cleanRemote(step.remote, filter) : step.remote;
  const session = step.session
    ? cleanSession(step.session, filter)
    : step.session;
  const report = step.report
    ? { ...step.report, summary: clean(step.report.summary, filter) }
    : undefined;
  return {
    ...step,
    name: clean(step.name, filter),
    output,
    ...(script ? { script } : {}),
    ...(remote ? { remote } : {}),
    session,
    ...(report ? { report } : {}),
    ...(filter.isFiltered ? { isDisplayFiltered: true } : {}),
  };
}

/** Filters only a UI response; scheduler results and durable checkpoints remain unchanged. */
export function displayPlanRun(run: AgentPlanRun): AgentPlanRun {
  return {
    ...run,
    steps: run.steps.map(displayStep),
    ...(run.loops
      ? {
          loops: run.loops.map((loop) => ({
            ...loop,
            iterations: loop.iterations.map((iteration) => ({
              ...iteration,
              nodes: iteration.nodes.map(displayStep),
            })),
          })),
        }
      : {}),
  };
}

/** Filters a checkpoint display copy and explicitly marks a changed output. */
export function displayPlanCheckpoint(
  checkpoint: AgentPlanCheckpoint | null,
): AgentPlanCheckpoint | null {
  if (!checkpoint) return null;
  const filter: DisplayFilter = { isFiltered: false };
  const result = checkpoint.result;
  const output = result.output === null ? null : clean(result.output, filter);
  const script = result.script
    ? { ...result.script, stderr: clean(result.script.stderr, filter) }
    : undefined;
  const report = result.report
    ? { ...result.report, summary: clean(result.report.summary, filter) }
    : undefined;
  const acceptance = cleanAcceptance(result.acceptance, filter);
  return {
    ...checkpoint,
    ...(filter.isFiltered ? { isDisplayFiltered: true } : {}),
    result: {
      ...result,
      output,
      ...(script ? { script } : {}),
      ...(report ? { report } : {}),
      acceptance,
      isOutputReduced: result.isOutputReduced || output !== result.output,
    },
  };
}
