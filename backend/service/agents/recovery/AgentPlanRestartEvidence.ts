import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

/** Removes only independently proven leases from the temporary process-check view. */
export function withoutProvenRestartSessions(
  run: AgentPlanRun,
  proven: ReadonlySet<string>,
): AgentPlanRun {
  const checkStep = (step: AgentPlanStepResult): AgentPlanStepResult =>
    step.session && proven.has(step.session.instanceId)
      ? { ...step, session: null }
      : step;
  const loops = run.loops?.map((loop) => {
    const sessions = loop.sessions.filter(
      (session) =>
        session.instanceId === null || !proven.has(session.instanceId),
    );
    const areAllProven = loop.sessions.length > 0 && sessions.length === 0;
    return {
      ...loop,
      sessions,
      cleanup: areAllProven ? ("confirmed" as const) : loop.cleanup,
      iterations: loop.iterations.map((iteration) => ({
        ...iteration,
        nodes: iteration.nodes.map(checkStep),
      })),
    };
  });
  return {
    ...run,
    steps: run.steps.map(checkStep),
    ...(loops ? { loops } : {}),
  };
}
