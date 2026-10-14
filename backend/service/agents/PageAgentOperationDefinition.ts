import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { changePageAgentParameters } from "./PageAgentParameterChanges";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { PageAgent, PageAgentInput } from "@/definition/PageAgent";
import type {
  PageAgentSharingEntry,
  PageAgentSharingOperator,
} from "@/definition/PageAgentOperations";
import type {
  PageAgentFields,
  PageAgentSharingRequest,
} from "./PageAgentOperationInput";

/**
 * The share as the definition stores it; private and global keep no targets.
 *
 * @param request - The requested share, or `undefined` for a private one.
 * @param operator - What a restricted share without an operator takes.
 */
export function toSharing(
  request: PageAgentSharingRequest | undefined,
  operator: PageAgentSharingOperator = "or",
): AgentConfiguration["sharing"] {
  if (request === undefined || request.scope === "private")
    return { isGlobal: false, targets: [] };
  if (request.scope === "global") return { isGlobal: true, targets: [] };
  return {
    isGlobal: false,
    targets: [
      ...request.groupIds.map((targetId) => ({
        kind: "group" as const,
        targetId,
      })),
      ...request.departmentIds.map((targetId) => ({
        kind: "department" as const,
        targetId,
      })),
    ],
    operator: request.operator ?? operator,
  };
}

/**
 * Describes a stored share with the current names of its groups and departments.
 *
 * @param sharing - The share as an agent or a plan stores it.
 * @param directory - The groups and departments of the instance.
 * @returns The share as a client reads it; targets that are gone are left out.
 */
export function sharingEntry(
  sharing: AgentConfiguration["sharing"],
  directory: AgentProfileDirectory,
): PageAgentSharingEntry {
  const named = (
    kind: "group" | "department",
    entries: AgentProfileDirectory["groups"],
  ): PageAgentSharingEntry["groups"] =>
    sharing.targets
      .filter((target) => target.kind === kind)
      .flatMap((target) => {
        const entry = entries.find(({ id }) => id === target.targetId);
        return entry ? [{ id: entry.id, name: entry.name }] : [];
      });
  const groups = named("group", directory.groups);
  const departments = named("department", directory.departments);
  if (sharing.isGlobal)
    return { scope: "global", operator: null, groups: [], departments: [] };
  if (groups.length + departments.length === 0)
    return { scope: "private", operator: null, groups: [], departments: [] };
  return {
    scope: "restricted",
    operator: sharing.operator ?? "or",
    groups,
    departments,
  };
}

/** The operator a restricted share has now; anything else counts as the default. */
function storedOperator(
  sharing: AgentConfiguration["sharing"],
): PageAgentSharingOperator {
  const isRestricted = !sharing.isGlobal && sharing.targets.length > 0;
  return isRestricted ? (sharing.operator ?? "or") : "or";
}

/** Compares what a change may touch, so a request that matches the agent writes nothing. */
export function definitionKey(input: {
  readonly name: string;
  readonly modelProfileId: string;
  readonly reasoningEffort: string | null;
  readonly configuration: AgentConfiguration;
}): string {
  const { configuration } = input;
  const { sharing } = configuration;
  const targets = sharing.targets
    .map((target) => `${target.kind}:${target.targetId}`)
    .sort();
  const hasTargets = !sharing.isGlobal && targets.length > 0;
  return JSON.stringify([
    input.name,
    input.modelProfileId,
    input.reasoningEffort,
    configuration.markdown,
    configuration.parameters,
    configuration.directoryParameter,
    sharing.isGlobal,
    hasTargets ? targets : [],
    hasTargets ? (sharing.operator ?? "or") : null,
  ]);
}

/** Merges only requested fields into the read definition, including parameter deltas. */
export function proposePageAgent(
  current: PageAgent,
  fields: PageAgentFields,
): PageAgentInput {
  // A changed model grant requires an explicit model selection, never a title-only repair.
  if (
    fields.modelProfileId === undefined &&
    current.availability.reason === "agent_usage_denied"
  )
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "model_unavailable",
    });
  const { configuration } = current;
  return {
    name: fields.name ?? current.name,
    modelProfileId: fields.modelProfileId ?? current.modelProfileId,
    reasoningEffort:
      fields.reasoningEffort === undefined
        ? current.reasoningEffort
        : fields.reasoningEffort,
    configuration: {
      ...configuration,
      markdown: fields.instruction ?? configuration.markdown,
      parameters:
        fields.parameters ??
        changePageAgentParameters(
          configuration.parameters,
          fields.parameterChanges,
        ),
      directoryParameter:
        fields.directoryParameter === undefined
          ? configuration.directoryParameter
          : fields.directoryParameter,
      sharing:
        fields.sharing === undefined
          ? configuration.sharing
          : toSharing(fields.sharing, storedOperator(configuration.sharing)),
    },
  };
}
