import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { PlanDependencies } from "./AgentPlanDependencies";

/** Resolves the plan workspace through the available catalog. */
export async function resolvePlanWorkspace(
  dependencies: PlanDependencies,
  userId: string,
  plan: AgentPlanInput,
): Promise<
  { readonly projectId: string } & Pick<AgentPlanInput, "executionTarget">
> {
  return (
    dependencies.workspaceCatalog?.resolve(userId, plan) ??
    dependencies.workspaces.resolve(userId, plan.workspaceId)
  );
}
