import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readAgentParameterValue } from "@/backend/agents/AgentConfigurationInput";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  agentParameterIssues,
  hasAgentParameterValue,
  scanAgentPlaceholders,
} from "@/definition/AgentParameters";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type {
  AgentParameter,
  AgentParameterValue,
} from "@/definition/AgentParameters";

/** Resolvers must authorize the executing user and project before returning any resource. */
export interface AgentReferenceResolvers {
  readonly ticket?: (
    id: string,
  ) => Promise<{ readonly markdown: string; readonly version: string }>;
  readonly workspace: (id: string) => Promise<{ readonly path: string }>;
  readonly wiki: (id: string) => Promise<{
    readonly markdown: string;
    readonly link: string;
    readonly version: string;
  }>;
}

/** Immutable preparation contract for later A10.4 steps; this never starts a runner. */
export interface BoundAgentParameters {
  readonly markdown: string;
  readonly directory: string | null;
  readonly values: Readonly<Record<string, AgentParameterValue | null>>;
  readonly wikiVersions: Readonly<Record<string, string>>;
}

interface ParameterResolution {
  readonly replacements: Readonly<Record<string, string>>;
  readonly directory: string | null;
  readonly version: string | null;
}

function readBindings(
  configuration: Pick<AgentConfiguration, "parameters" | "directoryParameter">,
  input: unknown,
): Readonly<Record<string, AgentParameterValue | null>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentError("parameter_invalid");
  const bindings = readAgentObject(input);
  if (
    Object.keys(bindings).some(
      (name) =>
        !configuration.parameters.some((parameter) => parameter.name === name),
    )
  )
    throw new AgentError("parameter_invalid");
  return Object.fromEntries(
    configuration.parameters.map((parameter) => {
      const bound = boundValue(parameter, bindings);
      if (bound !== null && bound.type !== parameter.type)
        throw new AgentError("parameter_invalid");
      if (
        (parameter.isRequired ||
          configuration.directoryParameter === parameter.name) &&
        !hasAgentParameterValue(bound)
      )
        throw new AgentError("parameter_required");
      return [parameter.name, bound];
    }),
  );
}

function boundValue(
  parameter: AgentParameter,
  bindings: Readonly<Record<string, unknown>>,
): AgentParameterValue | null {
  if (!Object.hasOwn(bindings, parameter.name)) return parameter.defaultValue;
  const value = bindings[parameter.name];
  return value === null ? null : readAgentParameterValue(value);
}

async function resolveParameter(
  parameter: AgentParameter,
  bound: AgentParameterValue | null,
  references: AgentReferenceResolvers,
): Promise<ParameterResolution> {
  const name = parameter.name;
  if (bound === null)
    return {
      replacements: {
        [name]: "",
        [`${name}.path`]: "",
        [`${name}.link`]: "",
        [`${name}.markdown`]: "",
      },
      directory: null,
      version: null,
    };
  if (bound.type === "text" || bound.type === "number")
    return {
      replacements: {
        [name]: bound.type === "text" ? bound.text : String(bound.number),
      },
      directory: null,
      version: null,
    };
  if (bound.type === "ticket") {
    if (!references.ticket)
      throw new AgentError("parameter_ticket_unavailable");
    const ticket = await references.ticket(bound.ticketId);
    return {
      replacements: { [name]: ticket.markdown },
      directory: null,
      version: null,
    };
  }
  if (bound.type === "workspace") {
    const workspace = await references.workspace(bound.workspaceId);
    return {
      replacements: { [`${name}.path`]: workspace.path },
      directory: workspace.path,
      version: null,
    };
  }
  const wiki = await references.wiki(bound.pageId);
  return {
    replacements: {
      [`${name}.link`]: wiki.link,
      [`${name}.markdown`]: wiki.markdown,
    },
    directory: null,
    version: wiki.version,
  };
}

/** Applies explicit step values over defaults, without modifying or recursively evaluating the template. */
export async function bindAgentParameters(
  configuration: Pick<
    AgentConfiguration,
    "markdown" | "parameters" | "directoryParameter"
  >,
  input: unknown,
  references: AgentReferenceResolvers,
): Promise<BoundAgentParameters> {
  if (agentParameterIssues(configuration).length > 0)
    throw new AgentError("parameter_invalid");
  const values = readBindings(configuration, input);
  const placeholders = scanAgentPlaceholders(
    configuration.markdown,
  ).placeholders;
  for (const placeholder of placeholders) {
    const bound = values[placeholder.name];
    if (!hasAgentParameterValue(bound ?? null))
      throw new AgentError("parameter_required");
  }
  const replacements: Record<string, string> = {};
  const wikiVersions: Record<string, string> = {};
  let directory: string | null = null;
  for (const parameter of configuration.parameters) {
    const resolved = await resolveParameter(
      parameter,
      values[parameter.name],
      references,
    );
    Object.assign(replacements, resolved.replacements);
    if (parameter.name === configuration.directoryParameter)
      directory = resolved.directory;
    if (resolved.version !== null)
      wikiVersions[parameter.name] = resolved.version;
  }
  let markdown = configuration.markdown;
  for (const placeholder of [...placeholders].reverse()) {
    const token =
      placeholder.property === "text"
        ? placeholder.name
        : `${placeholder.name}.${placeholder.property}`;
    const replacement = replacements[token];
    // A placeholder is never sent unresolved, not even as an empty or literal token.
    if (replacement === undefined)
      throw new AgentError("plan_placeholder_unresolved");
    markdown =
      markdown.slice(0, placeholder.start) +
      replacement +
      markdown.slice(placeholder.end);
  }
  if (markdown.length > 1_000_000) throw new AgentError("parameter_invalid");
  return { markdown, directory, values, wikiVersions };
}
