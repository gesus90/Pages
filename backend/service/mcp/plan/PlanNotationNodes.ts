import { readPlanBinding, readPlanNode } from "@/backend/agents/AgentPlanInput";
import { isAgentParameterName } from "@/definition/AgentParameters";

import { PlanNotationAttributes } from "./PlanNotationAttributes";
import { isPlanReaderRefusal } from "./PlanNotationIssue";
import { typedAttribute } from "./PlanNotationContext";
import { readPlanNotationFields } from "./PlanNotationNodeFields";
import {
  PLAN_NOTATION_BINDING_PREFIX,
  PLAN_NOTATION_FRAME_TYPES,
  PLAN_NOTATION_LITERAL_PREFIX,
  PLAN_NOTATION_NODE_TYPES,
  planNotationInputs,
} from "./PlanNotationVocabulary";

import type { AgentPlanBinding, AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { PlanNotationContext } from "./PlanNotationContext";
import type { PlanNotationLocation } from "./PlanNotationIssue";
import type {
  PlanNotationAttribute,
  PlanNotationStatement,
} from "./PlanNotationParser";

/** A node or frame of the notation, where it stands and what it holds. */
export interface PlanNotationDeclaration {
  readonly id: string;
  readonly location: PlanNotationLocation;
  readonly attributes: readonly PlanNotationAttribute[];
  /** The statements of a frame; `null` for a node. */
  readonly statements: readonly PlanNotationStatement[] | null;
}

/** The fields of a loop that the notation set itself, which its data edges must not change. */
export interface PlanNotationLoopFields {
  readonly mode?: AgentPlanLoop["mode"];
  readonly runsSource?: AgentPlanLoop["runsSource"];
}

/** What reading the nodes yields besides the nodes. */
export interface PlanNotationNodeRecords {
  /** Where every node and frame stands, by identifier. */
  readonly locations: Map<string, PlanNotationLocation>;
  /** The identifiers of nodes that were declared but could not be read. */
  readonly rejected: Set<string>;
  readonly loops: Map<string, PlanNotationLoopFields>;
}

/** Node types that hold bindings. */
const BINDING_TYPES: readonly string[] = [
  "agent",
  "script",
  "git_closeout",
  "group",
  "loop",
];

/** The declarations of one block: its nodes and frames in written order. */
export function planNotationDeclarations(
  statements: readonly PlanNotationStatement[],
): readonly PlanNotationDeclaration[] {
  return statements.flatMap((statement): PlanNotationDeclaration[] => {
    if (statement.kind === "node")
      return [
        {
          id: statement.id,
          location: statement,
          attributes: statement.attributes,
          statements: null,
        },
      ];
    if (statement.kind !== "subgraph") return [];
    return [
      {
        id: statement.id,
        location: statement,
        attributes: statement.statements.flatMap((entry) =>
          entry.kind === "assignment" ? [entry.attribute] : [],
        ),
        statements: statement.statements,
      },
    ];
  });
}

/** A fixed value of an input, read with the type the input declares. */
function literalBinding(
  attributes: PlanNotationAttributes,
  input: {
    readonly key: string;
    readonly type: Parameters<typeof typedAttribute>[2]["type"];
    readonly context: PlanNotationContext;
  },
): AgentPlanBinding | undefined {
  const value = typedAttribute(attributes, input.key, input);
  return value === undefined ? undefined : { kind: "literal", value };
}

/** Reads `bind.<input>` as a whole binding in JSON. */
function jsonBinding(
  attributes: PlanNotationAttributes,
  key: string,
): AgentPlanBinding | undefined {
  const json = attributes.json(key);
  if (json === undefined) return undefined;
  try {
    return readPlanBinding(json);
  } catch (error: unknown) {
    if (!isPlanReaderRefusal(error)) throw error;
    attributes.invalid(key);
    return undefined;
  }
}

/**
 * The bindings a node's attributes give: `in.<input>` fixed values and `bind.<input>` JSON.
 *
 * @remarks
 * A fixed value takes the type of the input it fills, so a ticket input
 * takes a ticket key and a workspace input a workspace name.
 */
function attributeBindings(
  node: AgentPlanNode,
  attributes: PlanNotationAttributes,
  context: PlanNotationContext,
): Record<string, AgentPlanBinding> {
  const inputs = planNotationInputs(node, context.sources.agents);
  const bindings: Record<string, AgentPlanBinding> = {};
  for (const name of attributes.suffixes(PLAN_NOTATION_LITERAL_PREFIX)) {
    const key = `${PLAN_NOTATION_LITERAL_PREFIX}${name}`;
    const type = inputs.get(name);
    if (type === undefined || type === null) {
      attributes.value(key);
      attributes.report(attributes.at(key), "unknown_port");
      continue;
    }
    const binding = literalBinding(attributes, { key, type, context });
    if (binding) bindings[name] = binding;
  }
  for (const name of attributes.suffixes(PLAN_NOTATION_BINDING_PREFIX)) {
    const key = `${PLAN_NOTATION_BINDING_PREFIX}${name}`;
    if (Object.hasOwn(bindings, name) || !isAgentParameterName(name)) {
      attributes.value(key);
      attributes.report(
        attributes.at(key),
        Object.hasOwn(bindings, name) ? "duplicate_field" : "invalid_value",
      );
      continue;
    }
    const binding = jsonBinding(attributes, key);
    if (binding) bindings[name] = binding;
  }
  return bindings;
}

/** The members of a frame: its agents, scripts and groups, and apart from them its decisions (PAGE-286). */
function frameMembers(
  nodes: readonly AgentPlanNode[],
): Record<string, unknown> {
  const decisions = nodes.filter((node) => node.type === "decision");
  return {
    steps: nodes.filter((node) => node.type !== "decision"),
    ...(decisions.length === 0 ? {} : { decisions }),
  };
}

/**
 * Reads the nodes and frames of a notation into plan nodes.
 *
 * @remarks
 * Each node passes the plan reader of the editor's save on its own, so a
 * node that cannot be stored is a `plan_invalid` finding at its place and
 * leaves the others intact. A frame reads its members first.
 */
export class PlanNotationNodeReader {
  public readonly records: PlanNotationNodeRecords = {
    locations: new Map(),
    rejected: new Set(),
    loops: new Map(),
  };
  private readonly context: PlanNotationContext;

  /**
   * Creates the reader.
   *
   * @param context - Resolves names and collects findings.
   */
  public constructor(context: PlanNotationContext) {
    this.context = context;
  }

  /**
   * Reads the declarations of a block.
   *
   * @param declarations - The nodes and frames in written order.
   * @returns The nodes that could be read.
   */
  public read(
    declarations: readonly PlanNotationDeclaration[],
  ): AgentPlanNode[] {
    return declarations.flatMap((declaration) => {
      if (this.records.locations.has(declaration.id)) {
        this.issue(declaration.location, "duplicate_node", declaration.id);
        return [];
      }
      this.records.locations.set(declaration.id, declaration.location);
      const node = this.readDeclaration(declaration);
      if (node === null) this.records.rejected.add(declaration.id);
      return node === null ? [] : [node];
    });
  }

  private issue(
    location: PlanNotationLocation,
    code: "duplicate_node" | "plan_invalid",
    nodeId: string,
  ): void {
    this.context.findings.issues.push({
      line: location.line,
      column: location.column,
      nodeId,
      code,
    });
  }

  private readDeclaration(
    declaration: PlanNotationDeclaration,
  ): AgentPlanNode | null {
    const { id, location } = declaration;
    const attributes = new PlanNotationAttributes(
      declaration.attributes,
      { nodeId: id, location },
      this.context.findings,
    );
    const isFrame = declaration.statements !== null;
    const type = this.readType(attributes, isFrame);
    if (type === undefined) {
      attributes.finish();
      return null;
    }
    const fields = readPlanNotationFields(type, attributes, this.context, id);
    const members =
      declaration.statements === null
        ? {}
        : frameMembers(
            this.read(planNotationDeclarations(declaration.statements)),
          );
    const bindings = BINDING_TYPES.includes(type) ? { bindings: {} } : {};
    const node = this.check(
      { ...fields, ...members, ...bindings, id, type, x: 0, y: 0 },
      location,
    );
    if (node?.type === "loop") this.noteLoop(node, attributes);
    const bound =
      node === null ? null : this.withBindings(node, attributes, location);
    // A node that could not be read reports that once, not each of its inputs as unknown.
    if (node === null)
      for (const prefix of [
        PLAN_NOTATION_LITERAL_PREFIX,
        PLAN_NOTATION_BINDING_PREFIX,
      ])
        for (const name of attributes.suffixes(prefix))
          attributes.value(`${prefix}${name}`);
    attributes.finish();
    return bound;
  }

  /** The type of a declaration; a frame is a group or loop, a node anything else. */
  private readType(
    attributes: PlanNotationAttributes,
    isFrame: boolean,
  ): (typeof PLAN_NOTATION_NODE_TYPES)[number] | undefined {
    if (!attributes.has("type")) {
      attributes.invalid("type");
      return undefined;
    }
    const type = attributes.choice(
      "type",
      isFrame ? PLAN_NOTATION_FRAME_TYPES : PLAN_NOTATION_NODE_TYPES,
    );
    if (!isFrame && (type === "group" || type === "loop")) {
      attributes.invalid("type");
      return undefined;
    }
    return type;
  }

  private noteLoop(
    loop: AgentPlanLoop,
    attributes: PlanNotationAttributes,
  ): void {
    this.records.loops.set(loop.id, {
      ...(attributes.has("mode") && loop.mode !== undefined
        ? { mode: loop.mode }
        : {}),
      ...(attributes.has("runsSource") ? { runsSource: loop.runsSource } : {}),
    });
  }

  private withBindings(
    node: AgentPlanNode,
    attributes: PlanNotationAttributes,
    location: PlanNotationLocation,
  ): AgentPlanNode | null {
    if (!("bindings" in node)) return node;
    const bindings = attributeBindings(node, attributes, this.context);
    if (Object.keys(bindings).length === 0) return node;
    return this.check({ ...node, bindings }, location);
  }

  /** Runs the plan reader on one node; a refusal is `plan_invalid` at its place. */
  private check(
    raw: Record<string, unknown>,
    location: PlanNotationLocation,
  ): AgentPlanNode | null {
    try {
      return readPlanNode(raw);
    } catch (error: unknown) {
      if (!isPlanReaderRefusal(error)) throw error;
      this.issue(location, "plan_invalid", String(raw.id));
      return null;
    }
  }
}
