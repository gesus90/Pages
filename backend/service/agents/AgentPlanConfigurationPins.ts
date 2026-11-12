import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import { allPlanSteps, mapPlanSteps } from "@/definition/AgentPlanGroup";
import { withInheritedPlanTarget } from "@/definition/AgentPlanTarget";

import { localPlanModelSteps } from "./AgentPlanRemoteExecution";
import { requireCompatibleFields } from "./AgentPlanGroupRuntime";
import { requireAllowedRunOptions } from "./AgentProfileValidation";

import type { AgentPlanInput, AgentPlanView } from "@/definition/AgentPlan";
import type { PlanDependencies } from "./AgentPlanDependencies";
import type { AgentPlanScripts } from "./AgentPlanScripts";

/**
 * Pins the configuration of every agent node of a plan to the profile it
 * came from, so a later change of the profile never changes a saved plan.
 */
export class AgentPlanConfigurationPins {
  private readonly dependencies: Pick<
    PlanDependencies,
    "profiles" | "remoteExecution"
  >;
  private readonly scripts: Pick<AgentPlanScripts, "requireProfiles">;

  public constructor(
    dependencies: Pick<PlanDependencies, "profiles" | "remoteExecution">,
    scripts: Pick<AgentPlanScripts, "requireProfiles">,
  ) {
    this.dependencies = dependencies;
    this.scripts = scripts;
  }

  /**
   * Copies the configuration of the source profile into every node without
   * one and checks that the nodes of a group agree on provider and connection.
   *
   * @param userId - The person who saves the plan.
   * @param plan - The plan as proposed, with its project.
   * @param previous - The saved plan it replaces, or `null` for a new one.
   * @returns The plan with a configuration on every agent node.
   */
  public async pin(
    userId: string,
    plan: AgentPlanInput,
    previous: AgentPlanView | null,
  ): Promise<AgentPlanInput> {
    await this.scripts.requireProfiles(
      withInheritedPlanTarget(plan).nodes,
      previous?.nodes ?? [],
    );
    const catalog = await this.dependencies.profiles.catalog(
      userId,
      plan.projectId ?? null,
    );
    const pinned = mapPlanSteps(plan, (node) => {
      if (node.configuration) return node;
      const saved = previous
        ? allPlanSteps(previous).find((entry) => entry.id === node.id)
        : undefined;
      if (saved?.agentId === node.agentId && saved.configuration)
        return { ...node, configuration: structuredClone(saved.configuration) };
      const source = catalog.find((entry) => entry.id === node.agentId);
      return source
        ? { ...node, configuration: copyPlanConfiguration(source) }
        : node;
    });
    const groupConnections = new Map<
      string,
      Readonly<Record<string, string>>
    >();
    for (const node of await localPlanModelSteps(
      this.dependencies.remoteExecution,
      userId,
      pinned,
    )) {
      if (!node.configuration) continue;
      const resolved = await this.dependencies.profiles.resolveDefinition(
        userId,
        {
          agentId: node.agentId,
          personalAgentId: node.personalAgentId,
          projectId: plan.projectId ?? previous?.projectId ?? null,
          configuration: node.configuration,
        },
      );
      const group = pinned.nodes.find(
        (entry) =>
          entry.type === "group" &&
          entry.steps.some((step) => step.id === node.id),
      );
      if (group) {
        const fields = {
          "provider/adapter": resolved.assignment.connection.provider,
          connectionId: resolved.assignment.connection.id,
        };
        if (!isAcpProvider(fields["provider/adapter"]))
          throw new AgentPlanValidationError([
            {
              nodeId: node.id,
              port: "provider/adapter",
              reason: "groupProvider",
            },
          ]);
        requireCompatibleFields(
          node.id,
          fields,
          groupConnections.get(group.id) ?? null,
        );
        groupConnections.set(group.id, fields);
      }
      const saved = previous
        ? allPlanSteps(previous).find((entry) => entry.id === node.id)
        : undefined;
      requireAllowedRunOptions(
        resolved.assignment.connection.provider,
        node.configuration.template.run,
        saved?.configuration?.template.run,
      );
    }
    return pinned;
  }
}
