import { planEdgeBranch, planEdgeKind } from "@/definition/AgentPlanBranching";
import { isPlanResultNode } from "@/definition/AgentPlanGraph";
import { planGroupEdges } from "@/definition/AgentPlanGroup";

import { planNotationTargetEntries } from "./PlanNotationAgentWriter";
import { isSamePlanValue } from "./PlanNotationEquality";
import {
  jsonEntry,
  planNotationAttributeList,
  planNotationWord,
  quotedPlanNotation,
  textEntry,
  wordEntry,
} from "./PlanNotationFormat";
import { PlanNotationNames } from "./PlanNotationNames";
import {
  planNotationNodeEntries,
  planNotationValueText,
} from "./PlanNotationNodeWriter";
import { PLAN_NOTATION_CLUSTER_PREFIX } from "./PlanNotationParser";
import {
  PLAN_NOTATION_BINDING_PREFIX,
  PLAN_NOTATION_CONDITION_INPUT,
  PLAN_NOTATION_EVENT_INPUT,
  PLAN_NOTATION_GLOBAL_PREFIX,
  PLAN_NOTATION_LITERAL_PREFIX,
  allPlanNotationNodes,
  planNotationInputs,
} from "./PlanNotationVocabulary";

import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanInput,
  AgentPlanNode,
} from "@/definition/AgentPlan";
import type { AgentPlanLoopContent } from "@/definition/AgentPlanLoop";
import type { PlanNotationWriterContext } from "./PlanNotationAgentWriter";
import type { PlanNotationEntry } from "./PlanNotationFormat";
import type { PlanNotationCatalog } from "./PlanNotationNames";

const INDENT = "  ";

/** The sharing a new plan gets when the notation names none. */
const DEFAULT_SHARING = { isGlobal: false, targets: [], operator: "or" };

/** One binding of a node: the edge statement that writes it, or attributes of the node. */
type BindingForm =
  | { readonly kind: "edge"; readonly statement: string }
  | { readonly kind: "entry"; readonly entry: PlanNotationEntry };

function id(text: string): string {
  return planNotationWord(text);
}

/** The sharing unless it is the default; `null` for a plan stored before sharing. */
function sharingEntries(plan: AgentPlanInput): readonly PlanNotationEntry[] {
  if (plan.sharing === undefined) return [jsonEntry("sharing", null)];
  return isSamePlanValue(plan.sharing, DEFAULT_SHARING)
    ? []
    : [jsonEntry("sharing", plan.sharing)];
}

function planEntries(
  context: PlanNotationWriterContext,
): readonly PlanNotationEntry[] {
  const { plan, names } = context;
  const workspace = names.workspaceName(plan.workspaceId);
  return [
    workspace === plan.workspaceId
      ? textEntry("workspaceId", plan.workspaceId)
      : wordEntry("workspace", workspace),
    wordEntry("usage", plan.usage),
    ...sharingEntries(plan),
    ...planNotationTargetEntries(plan.executionTarget, names),
    ...Object.entries(plan.globals).map(([key, text]) =>
      textEntry(`${PLAN_NOTATION_GLOBAL_PREFIX}${key}`, text),
    ),
  ];
}

/** Writes a stored edge; an edge of no known kind has no notation and is named in a comment. */
function edgeStatement(edge: AgentPlanEdge): string {
  const link = `${id(edge.from)} -> ${id(edge.to)}`;
  const kind = planEdgeKind(edge);
  if (kind === "flow") return `${link};`;
  if (kind === "branch")
    return `${link} [branch=${planEdgeBranch(edge) ?? "true"}];`;
  if (kind === "condition")
    return `${link} [in=${PLAN_NOTATION_CONDITION_INPUT}];`;
  if (kind === "event") return `${link} [in=${PLAN_NOTATION_EVENT_INPUT}];`;
  return `// ${edge.from} ${edge.fromPort} -> ${edge.to} ${edge.toPort} has no notation`;
}

/** Whether the edge reader would accept a data edge of this binding into this input. */
function edgeAttributes(
  binding: AgentPlanBinding,
  source: AgentPlanNode | undefined,
  target: AgentPlanNode,
): readonly PlanNotationEntry[] | null {
  if (!source || target.type === "group") return null;
  const isLoop = target.type === "loop";
  if (binding.kind === "source")
    return ["parameter", "task", "variable"].includes(source.type) ? [] : null;
  if (binding.kind === "stack") {
    if (source.type !== "stack") return null;
    if (binding.output === "count") return [wordEntry("out", "count")];
    return isLoop ? null : [];
  }
  if (isLoop || !isPlanResultNode(source)) return null;
  if (binding.kind === "result") return [];
  return binding.kind === "previous" ? [wordEntry("previous", "true")] : null;
}

/** The node a binding other than a fixed value reads. */
function boundNode(
  binding: Exclude<AgentPlanBinding, { kind: "literal" }>,
): string {
  if (binding.kind === "source") return binding.nodeId;
  return binding.kind === "stack" ? binding.stackId : binding.stepId;
}

function bindingForm(
  target: AgentPlanNode,
  name: string,
  input: {
    readonly binding: AgentPlanBinding;
    readonly context: PlanNotationWriterContext;
  },
): BindingForm {
  const { binding, context } = input;
  const json = {
    kind: "entry" as const,
    entry: jsonEntry(`${PLAN_NOTATION_BINDING_PREFIX}${name}`, binding),
  };
  const inputs = planNotationInputs(target, context.sources.agents);
  const type = inputs.get(name);
  if (type === undefined) return json;
  if (binding.kind === "literal") {
    if (type === null || binding.value === null || binding.value.type !== type)
      return json;
    const text = planNotationValueText(binding.value, context);
    return text === null
      ? json
      : {
          kind: "entry",
          entry: { key: `${PLAN_NOTATION_LITERAL_PREFIX}${name}`, value: text },
        };
  }
  const sourceId = boundNode(binding);
  const source = allPlanNotationNodes(context.plan).find(
    (node) => node.id === sourceId,
  );
  const attributes = edgeAttributes(binding, source, target);
  if (attributes === null) return json;
  const list = planNotationAttributeList([
    wordEntry("in", name),
    ...attributes,
  ]);
  return {
    kind: "edge",
    statement: `${id(sourceId)} -> ${id(target.id)}${list};`,
  };
}

function bindingForms(
  node: AgentPlanNode,
  context: PlanNotationWriterContext,
): readonly BindingForm[] {
  if (!("bindings" in node)) return [];
  return Object.entries(node.bindings).map(([name, binding]) =>
    bindingForm(node, name, { binding, context }),
  );
}

function bindingEntries(
  forms: readonly BindingForm[],
): readonly PlanNotationEntry[] {
  return forms.flatMap((form) => (form.kind === "entry" ? [form.entry] : []));
}

function bindingEdges(forms: readonly BindingForm[]): readonly string[] {
  return forms.flatMap((form) =>
    form.kind === "edge" ? [form.statement] : [],
  );
}

function isFrame(node: AgentPlanNode | AgentPlanLoopContent): boolean {
  return node.type === "group" || node.type === "loop";
}

/** Writes one plan as notation; a class only to share the context between its parts. */
class PlanNotationDocumentWriter {
  private readonly context: PlanNotationWriterContext;

  public constructor(context: PlanNotationWriterContext) {
    this.context = context;
  }

  /** The whole notation: plan attributes, nodes, edges and frames, in this order. */
  public write(): string {
    const { plan } = this.context;
    const lines = [`digraph ${quotedPlanNotation(plan.name)} {`];
    for (const entry of planEntries(this.context))
      lines.push(`${INDENT}${entry.key} = ${entry.value};`);
    const nodes = plan.nodes.filter((node) => !isFrame(node));
    if (nodes.length > 0) lines.push("");
    for (const node of nodes)
      lines.push(`${INDENT}${this.nodeStatement(node)}`);
    const edges = [
      ...plan.edges.map(edgeStatement),
      ...plan.nodes.flatMap((node) =>
        bindingEdges(bindingForms(node, this.context)),
      ),
    ];
    if (edges.length > 0) lines.push("");
    for (const edge of edges) lines.push(`${INDENT}${edge}`);
    for (const frame of plan.nodes.filter(isFrame)) {
      lines.push("");
      lines.push(...this.frameLines(frame, INDENT));
    }
    lines.push("}");
    return `${lines.join("\n")}\n`;
  }

  private nodeStatement(node: AgentPlanNode): string {
    const entries = [
      ...planNotationNodeEntries(node, this.context),
      ...bindingEntries(bindingForms(node, this.context)),
    ];
    return `${id(node.id)}${planNotationAttributeList(entries)};`;
  }

  /** A frame as `subgraph cluster_<id>`: its attributes, members, internal edges and member bindings. */
  private frameLines(frame: AgentPlanNode, indent: string): readonly string[] {
    if (frame.type !== "group" && frame.type !== "loop") return [];
    const inner = `${indent}${INDENT}`;
    const entries = [
      ...planNotationNodeEntries(frame, this.context),
      ...bindingEntries(bindingForms(frame, this.context)),
    ];
    const lines = [
      `${indent}subgraph ${id(`${PLAN_NOTATION_CLUSTER_PREFIX}${frame.id}`)} {`,
    ];
    for (const entry of entries)
      lines.push(`${inner}${entry.key} = ${entry.value};`);
    for (const member of frame.steps)
      if (isFrame(member)) lines.push(...this.frameLines(member, inner));
      else lines.push(`${inner}${this.nodeStatement(member)}`);
    const edges = frame.type === "group" ? planGroupEdges(frame) : frame.edges;
    for (const edge of edges) lines.push(`${inner}${edgeStatement(edge)}`);
    for (const member of frame.steps)
      if (!isFrame(member))
        for (const edge of bindingEdges(bindingForms(member, this.context)))
          lines.push(`${inner}${edge}`);
    lines.push(`${indent}}`);
    return lines;
  }
}

/**
 * Writes a plan as notation (PAGE-250).
 *
 * @param plan - The stored plan.
 * @param catalog - The choices of the plan's workspace, which turn identifiers into names.
 * @returns The notation: plan attributes, nodes in stored order, edges, frames.
 *
 * @remarks
 * Every field is written in a short form where that reads back to the same
 * value, by name where the name is unique, and in its long form otherwise.
 * Positions are never written. Read back unchanged, the notation gives the
 * same plan, so replacing a plan with its own notation changes nothing but
 * its revision.
 */
export function writePlanNotation(
  plan: AgentPlanInput,
  catalog: PlanNotationCatalog,
): string {
  return new PlanNotationDocumentWriter({
    names: new PlanNotationNames(catalog),
    sources: catalog.sources,
    plan,
  }).write();
}
