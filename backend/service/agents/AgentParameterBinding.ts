import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readAgentParameterValue } from "@/backend/agents/AgentConfigurationInput";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  agentParameterIssues,
  hasAgentParameterValue,
  scanAgentPlaceholders,
} from "@/definition/AgentParameters";

import {
  ticketAssetReferences,
  externalAssetNotes,
} from "./AgentTicketAssetReferences";
import { planAssetInput, planAssetPromptText } from "./assets/PlanAssetInput";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type {
  ResolvedAgentTicket,
  AgentTicketInput,
} from "@/definition/AgentTicketParameter";
import type {
  AgentParameter,
  AgentParameterValue,
} from "@/definition/AgentParameters";

/** Resolvers must authorize the executing user and project before returning any resource. */
export interface AgentReferenceResolvers {
  /** Plans pass incomplete inputs to their steps; direct agent calls remain strict. */
  readonly allowIncomplete?: boolean;
  readonly ticket?: (id: string) => Promise<ResolvedAgentTicket>;
  readonly workspace: (id: string) => Promise<{ readonly path: string }>;
  readonly wiki: (id: string) => Promise<{
    readonly markdown: string;
    readonly link: string;
    readonly version: string;
  }>;
  /** Describes a plan asset after checking that the executor may read it. */
  readonly asset?: (id: string) => Promise<AgentPlanAssetFile>;
}

/** Immutable preparation contract for later A10.4 steps; this never starts a runner. */
export interface BoundAgentParameters {
  readonly markdown: string;
  readonly directory: string | null;
  readonly values: Readonly<Record<string, AgentParameterValue | null>>;
  readonly wikiVersions: Readonly<Record<string, string>>;
  /** Objects keyed by declaration name; a bare ticket or .assets requests file delivery. */
  readonly tickets: Readonly<Record<string, ResolvedAgentTicket>>;
  readonly assetInputs: readonly AgentTicketInput[];
}

interface ParameterResolution {
  readonly replacements: Readonly<Record<string, string>>;
  readonly directory: string | null;
  readonly version: string | null;
  readonly ticket?: ResolvedAgentTicket;
  readonly assetInput?: AgentTicketInput;
}

function readBindings(
  configuration: Pick<AgentConfiguration, "parameters" | "directoryParameter">,
  input: unknown,
  allowIncomplete = false,
): Readonly<Record<string, AgentParameterValue | null>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentError("parameter_invalid");
  const bindings = readAgentObject(input);
  if (
    !allowIncomplete &&
    Object.keys(bindings).some(
      (name) =>
        !configuration.parameters.some((parameter) => parameter.name === name),
    )
  )
    throw new AgentError("parameter_invalid");
  return Object.fromEntries(
    configuration.parameters.map((parameter) => {
      const bound = allowIncomplete
        ? incompleteValue(parameter, bindings)
        : boundValue(parameter, bindings);
      if (bound !== null && bound.type !== parameter.type)
        throw new AgentError("parameter_invalid");
      if (
        !allowIncomplete &&
        (parameter.isRequired ||
          configuration.directoryParameter === parameter.name) &&
        !hasAgentParameterValue(bound)
      )
        throw new AgentError("parameter_required");
      return [parameter.name, bound];
    }),
  );
}

function incompleteValue(
  parameter: AgentParameter,
  bindings: Readonly<Record<string, unknown>>,
): AgentParameterValue | null {
  try {
    const bound = boundValue(parameter, bindings);
    return bound?.type === parameter.type && hasAgentParameterValue(bound)
      ? bound
      : null;
  } catch (error: unknown) {
    if (error instanceof AgentError) return null;
    throw error;
  }
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
        [`${name}.description`]: "",
        [`${name}.assets`]: "",
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
      replacements: {
        [name]: ticket.markdown,
        [`${name}.description`]: ticket.description,
        [`${name}.assets`]: JSON.stringify({
          parameter: name,
          ticketId: ticket.id,
          ticketKey: ticket.key,
          assets: ticket.assets,
        }),
      },
      directory: null,
      version: null,
      ticket,
    };
  }
  if (bound.type === "asset")
    return resolveAsset(name, bound.assetId, references);
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
      [`${name}.markdown`]: wiki.markdown + externalAssetNotes(wiki.markdown),
    },
    directory: null,
    version: wiki.version,
    assetInput: {
      parameter: name,
      owner: "wiki",
      ticket: {
        id: bound.pageId,
        key: wiki.link,
        title: wiki.link,
        description: wiki.markdown,
        markdown: wiki.markdown,
        version: wiki.version,
        assets: ticketAssetReferences(wiki.markdown),
      },
    },
  };
}

/** An asset parameter names its file in the text and hands the file itself over. */
async function resolveAsset(
  name: string,
  assetId: string,
  references: AgentReferenceResolvers,
): Promise<ParameterResolution> {
  if (!references.asset) throw new AgentError("parameter_asset_unavailable");
  const file = await references.asset(assetId);
  return {
    replacements: { [name]: planAssetPromptText(file) },
    directory: null,
    version: null,
    assetInput: planAssetInput(name, file),
  };
}

function assertParameterConfiguration(
  configuration: Pick<
    AgentConfiguration,
    "markdown" | "parameters" | "directoryParameter"
  >,
  references: AgentReferenceResolvers,
): void {
  if (
    !references.allowIncomplete &&
    agentParameterIssues(configuration).length > 0
  )
    throw new AgentError("parameter_invalid");
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
  if (scanAgentPlaceholders(configuration.markdown).hasUnsupportedRunNotes)
    throw new AgentError("run_notes_unsupported");
  assertParameterConfiguration(configuration, references);
  const values = readBindings(configuration, input, references.allowIncomplete);
  const placeholders = scanAgentPlaceholders(
    configuration.markdown,
  ).placeholders;
  for (const placeholder of placeholders) {
    const bound = values[placeholder.name];
    if (!references.allowIncomplete && !hasAgentParameterValue(bound ?? null))
      throw new AgentError("parameter_required");
  }
  const replacements: Record<string, string> = {};
  const wikiVersions: Record<string, string> = {};
  const tickets: Record<string, ResolvedAgentTicket> = {};
  const assetInputs: AgentTicketInput[] = [];
  let directory: string | null = null;
  for (const parameter of configuration.parameters) {
    const resolved = await resolveParameter(
      parameter,
      values[parameter.name],
      references,
    );
    Object.assign(replacements, resolved.replacements);
    if (resolved.ticket) {
      tickets[parameter.name] = resolved.ticket;
      if (
        placeholders.some(
          (entry) =>
            entry.name === parameter.name &&
            (entry.property === "text" || entry.property === "assets"),
        )
      )
        assetInputs.push({
          parameter: parameter.name,
          ticket: resolved.ticket,
        });
    }
    // An asset is handed over whenever it is bound, a wiki page only when its markdown is named.
    if (
      resolved.assetInput &&
      (resolved.assetInput.owner === "asset" ||
        placeholders.some(
          (entry) =>
            entry.name === parameter.name && entry.property === "markdown",
        ))
    )
      assetInputs.push(resolved.assetInput);
    if (parameter.name === configuration.directoryParameter)
      directory = resolved.directory;
    if (resolved.version !== null)
      wikiVersions[parameter.name] = resolved.version;
  }
  const markdown = replacePlaceholders(
    configuration.markdown,
    replacements,
    references.allowIncomplete,
  );
  if (markdown.length > 1_000_000) throw new AgentError("parameter_invalid");
  return { markdown, directory, values, wikiVersions, tickets, assetInputs };
}

function replacePlaceholders(
  source: string,
  replacements: Readonly<Record<string, string>>,
  allowIncomplete = false,
): string {
  const { placeholders } = scanAgentPlaceholders(source);
  let markdown = source;
  for (const placeholder of [...placeholders].reverse()) {
    const token =
      placeholder.property === "text"
        ? placeholder.name
        : `${placeholder.name}.${placeholder.property}`;
    const replacement =
      replacements[token] ?? (allowIncomplete ? "" : undefined);
    // A placeholder is never sent unresolved, not even as an empty or literal token.
    if (replacement === undefined)
      throw new AgentError("plan_placeholder_unresolved");
    markdown =
      markdown.slice(0, placeholder.start) +
      replacement +
      markdown.slice(placeholder.end);
  }
  return markdown;
}
