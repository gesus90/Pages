import { AgentError } from "@/backend/error/AgentErrors";
import {
  AGENT_RUN_TIMEOUT_MINUTES,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";
import { isAgentParameterName } from "@/definition/AgentParameters";
import { isAgentProfileTargetKind } from "@/definition/AgentProfile";

import { readAgentObject } from "./AgentPayload";

import type {
  AgentConfiguration,
  AgentRunOptions,
} from "@/definition/AgentConfiguration";
import type {
  AgentParameter,
  AgentParameterValue,
} from "@/definition/AgentParameters";
import type { AgentProfileTarget } from "@/definition/AgentProfile";

function text(input: unknown, maximum: number, allowEmpty = false): string {
  if (
    typeof input !== "string" ||
    input.length > maximum ||
    (!allowEmpty && !input.trim())
  )
    throw new AgentError("configuration_invalid");
  return input;
}

/** Validates a typed step value without resolving or copying a referenced resource. */
export function readAgentParameterValue(input: unknown): AgentParameterValue {
  const entry = readAgentObject(input);
  switch (entry.type) {
    case "text":
      return { type: "text", text: text(entry.text, 200_000, true) };
    case "number":
      if (typeof entry.number !== "number" || !Number.isFinite(entry.number))
        throw new AgentError("parameter_number_invalid");
      return { type: "number", number: entry.number };
    case "ticket":
      return { type: "ticket", ticketId: text(entry.ticketId, 100).trim() };
    case "workspace":
      return {
        type: "workspace",
        workspaceId: text(entry.workspaceId, 100).trim(),
      };
    case "wiki":
      return { type: "wiki", pageId: text(entry.pageId, 100).trim() };
    default:
      throw new AgentError("parameter_invalid");
  }
}

function parameter(input: unknown): AgentParameter {
  const entry = readAgentObject(input);
  const name = text(entry.name, 64);
  if (
    !isAgentParameterName(name) ||
    (entry.type !== "text" &&
      entry.type !== "number" &&
      entry.type !== "ticket" &&
      entry.type !== "workspace" &&
      entry.type !== "wiki") ||
    typeof entry.isRequired !== "boolean"
  )
    throw new AgentError("parameter_invalid");
  const defaultValue =
    entry.defaultValue === null
      ? null
      : readAgentParameterValue(entry.defaultValue);
  if (defaultValue !== null && defaultValue.type !== entry.type)
    throw new AgentError("parameter_invalid");
  return {
    name,
    type: entry.type,
    description: text(entry.description, 1000, true),
    isRequired: entry.isRequired,
    defaultValue,
  };
}

/** Reads usage or access grants while preserving their distinct authorization meaning. */
export function readAgentTargets(
  input: unknown,
): readonly AgentProfileTarget[] {
  if (!Array.isArray(input) || input.length > 200)
    throw new AgentError("profile_invalid");
  const targets = input.map((entry: unknown): AgentProfileTarget => {
    const target = readAgentObject(entry);
    if (!isAgentProfileTargetKind(target.kind))
      throw new AgentError("profile_invalid");
    return { kind: target.kind, targetId: text(target.targetId, 100).trim() };
  });
  return targets.filter(
    (target, index) =>
      targets.findIndex(
        (entry) =>
          entry.kind === target.kind && entry.targetId === target.targetId,
      ) === index,
  );
}

/** Converts old profile callers into the same agent aggregate, preserving their grants. */
export function configurationForTargets(
  targets: readonly AgentProfileTarget[],
): AgentConfiguration {
  const scope = targets[0]?.kind ?? "system";
  return {
    ...emptyAgentConfiguration(scope),
    sharing: {
      isGlobal: targets.some((target) => target.kind === "system"),
      targets: targets.filter((target) => target.kind !== "system"),
    },
  };
}

/** Reads the run options of an agent; anything malformed is refused, never defaulted. */
function readRunOptions(input: unknown): AgentRunOptions {
  const options = readAgentObject(input);
  const minutes = options.timeoutMinutes;
  if (
    (options.access !== "workspace_write" &&
      options.access !== "read_only" &&
      options.access !== "yolo") ||
    typeof options.shell !== "boolean" ||
    typeof options.web !== "boolean" ||
    typeof minutes !== "number" ||
    !Number.isSafeInteger(minutes) ||
    minutes < AGENT_RUN_TIMEOUT_MINUTES.minimum ||
    minutes > AGENT_RUN_TIMEOUT_MINUTES.maximum
  )
    throw new AgentError("configuration_invalid");
  return {
    access: options.access,
    shell: options.shell,
    web: options.web,
    timeoutMinutes: minutes,
  };
}

/** Parses stored and external task sections; references remain identifiers. */
export function readAgentConfiguration(input: unknown): AgentConfiguration {
  const configuration = readAgentObject(input);
  const sharing = readAgentObject(configuration.sharing);
  if (
    !isAgentProfileTargetKind(configuration.scope) ||
    (configuration.accessMode !== "personal" &&
      configuration.accessMode !== "shared") ||
    typeof sharing.isGlobal !== "boolean" ||
    !Array.isArray(configuration.parameters) ||
    configuration.parameters.length > 50
  )
    throw new AgentError("configuration_invalid");
  const targets = readAgentTargets(sharing.targets);
  if (
    sharing.operator !== undefined &&
    sharing.operator !== "and" &&
    sharing.operator !== "or"
  )
    throw new AgentError("configuration_invalid");
  if (targets.some((target) => target.kind === "system"))
    throw new AgentError("configuration_invalid");
  return {
    scope: configuration.scope,
    tag: text(configuration.tag, 40, true).trim(),
    markdown: text(configuration.markdown, 200_000, true),
    projectId:
      configuration.projectId === null
        ? null
        : text(configuration.projectId, 100).trim(),
    accessMode: configuration.accessMode,
    parameters: configuration.parameters.map(parameter),
    directoryParameter:
      configuration.directoryParameter === null
        ? null
        : text(configuration.directoryParameter, 64),
    sharing: {
      isGlobal: sharing.isGlobal,
      targets,
      ...(sharing.operator === undefined ? {} : { operator: sharing.operator }),
    },
    ...(configuration.run === undefined
      ? {}
      : { run: readRunOptions(configuration.run) }),
  };
}
