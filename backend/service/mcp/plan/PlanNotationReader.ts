import {
  readPlanInput,
  readPlanSharing,
} from "@/backend/agents/AgentPlanInput";
import { planConnectionIssues } from "@/definition/AgentPlanGraph";
import { replacePlanNode } from "@/definition/AgentPlanGroupEdit";
import { planExecutionTargetSchema } from "@/definition/AgentPlanExecution";

import { PlanNotationAttributes } from "./PlanNotationAttributes";
import { targetAttribute } from "./PlanNotationContext";
import {
  applyPlanNotationEdge,
  readPlanNotationEdgeSpec,
} from "./PlanNotationEdges";
import { isPlanReaderRefusal, planNotationIssue } from "./PlanNotationIssue";
import {
  PlanNotationNodeReader,
  planNotationDeclarations,
} from "./PlanNotationNodes";
import { PLAN_NOTATION_GLOBAL_PREFIX } from "./PlanNotationVocabulary";

import type { PlanRankDirection } from "@/definition/AgentPlanAutoLayout";
import type { AgentPlanInput, AgentPlanNode } from "@/definition/AgentPlan";
import type { PlanNotationContext } from "./PlanNotationContext";
import type {
  PlanNotationIssue,
  PlanNotationLocation,
} from "./PlanNotationIssue";
import type { PlanNotationNodeRecords } from "./PlanNotationNodes";
import type {
  PlanNotationAttribute,
  PlanNotationDocument,
  PlanNotationEdgeStatement,
  PlanNotationStatement,
} from "./PlanNotationParser";

/** What a notation reads as: the plan without positions and everything a check reports. */
export interface PlanNotationBuild {
  /** The plan; every position is still 0, the layout places the nodes. */
  readonly plan: AgentPlanInput;
  readonly rankdir: PlanRankDirection;
  readonly issues: readonly PlanNotationIssue[];
  /** Where each node and frame stands in the notation. */
  readonly locations: ReadonlyMap<string, PlanNotationLocation>;
}

/** The plan attributes a notation sets, read before the catalog of its workspace is known. */
export interface PlanNotationHead {
  /** `workspace` or `workspaceId` as written, or `null` when absent. */
  readonly workspace: {
    readonly value: string;
    readonly isIdentifier: boolean;
    readonly location: PlanNotationLocation;
  } | null;
}

function assignments(
  statements: readonly PlanNotationStatement[],
): readonly PlanNotationAttribute[] {
  return statements.flatMap((statement) =>
    statement.kind === "assignment" ? [statement.attribute] : [],
  );
}

/**
 * Names the workspace a notation asks for, so its catalog can be loaded first.
 *
 * @param document - The read notation.
 */
export function readPlanNotationHead(
  document: PlanNotationDocument,
): PlanNotationHead {
  const attribute = assignments(document.statements).find(
    (entry) => entry.key === "workspace" || entry.key === "workspaceId",
  );
  return {
    workspace: attribute
      ? {
          value: attribute.value.text,
          isIdentifier: attribute.key === "workspaceId",
          location: attribute,
        }
      : null,
  };
}

/** The edge statements of a block and of every frame inside it, in written order. */
function edgeStatements(
  statements: readonly PlanNotationStatement[],
): readonly PlanNotationEdgeStatement[] {
  return statements.flatMap((statement) => {
    if (statement.kind === "edge") return [statement];
    return statement.kind === "subgraph"
      ? edgeStatements(statement.statements)
      : [];
  });
}

/** A JSON object whose values are all texts, as `globals` holds them. */
function textRecord(input: unknown): Readonly<Record<string, string>> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return null;
  const entries = Object.entries(input);
  return entries.every(([, text]) => typeof text === "string")
    ? Object.fromEntries(entries.map(([key, text]) => [key, String(text)]))
    : null;
}

/** `global.<key>="<value>"` entries, or the whole `globals` JSON. */
function readGlobals(
  attributes: PlanNotationAttributes,
): Readonly<Record<string, string>> {
  const keys = attributes.suffixes(PLAN_NOTATION_GLOBAL_PREFIX);
  if (!attributes.has("globals"))
    return Object.fromEntries(
      keys.map((key) => [
        key,
        attributes.text(`${PLAN_NOTATION_GLOBAL_PREFIX}${key}`) ?? "",
      ]),
    );
  if (keys.length > 0)
    attributes.report(attributes.at("globals"), "duplicate_field");
  const globals = textRecord(attributes.json("globals"));
  if (globals === null) attributes.invalid("globals");
  return globals ?? {};
}

/** `sharing` as JSON; `null` writes the absent sharing of a plan stored before sharing. */
/**
 * Reads the plan name: the name of the `digraph` is its short form, the
 * plan attribute `name` its long form; both at once are `duplicate_field`.
 */
function planName(
  attributes: PlanNotationAttributes,
  document: PlanNotationDocument,
): string {
  const written = attributes.text("name");
  if (written === undefined) return document.name ?? "";
  if (document.name === null) return written;
  attributes.report(attributes.at("name"), "duplicate_field");
  return document.name;
}

function readSharing(
  attributes: PlanNotationAttributes,
): Pick<AgentPlanInput, "sharing"> {
  if (!attributes.has("sharing"))
    return { sharing: { isGlobal: false, targets: [], operator: "or" } };
  const sharing = attributes.json("sharing");
  if (sharing === null) return {};
  try {
    return { sharing: readPlanSharing(sharing) };
  } catch (error: unknown) {
    if (!isPlanReaderRefusal(error)) throw error;
    attributes.invalid("sharing");
    return {};
  }
}

/**
 * Reads a notation into a plan, as the editor would have built it (PAGE-250).
 *
 * @remarks
 * The plan attributes come first, then every node and frame, then every
 * edge in written order. Names resolve against the catalog of the plan's
 * workspace. The result passes the plan reader and the graph check of the
 * editor's save; their findings are `plan_invalid`. Nothing is stored.
 */
export class PlanNotationReader {
  private context: PlanNotationContext;
  private nodes: PlanNotationNodeReader;

  /**
   * Creates the reader.
   *
   * @param context - The catalog, the stored plan when replacing and the
   * findings; its plan target is the remote target of a remote workspace,
   * which the plan's own `target` cannot change, and else the Pages host.
   */
  public constructor(context: PlanNotationContext) {
    this.context = context;
    this.nodes = new PlanNotationNodeReader(context);
  }

  private get records(): PlanNotationNodeRecords {
    return this.nodes.records;
  }

  /**
   * Reads a whole notation.
   *
   * @param document - The read notation.
   * @param workspaceId - The resolved workspace of the plan.
   * @returns The plan and every finding; with findings the plan must not be stored.
   */
  public read(
    document: PlanNotationDocument,
    workspaceId: string,
  ): PlanNotationBuild {
    const head = new PlanNotationAttributes(
      assignments(document.statements),
      { nodeId: null, location: document },
      this.context.findings,
    );
    const name = planName(head, document);
    const fields = this.planFields(head, workspaceId);
    const rankdir = head.choice("rankdir", ["TB", "LR"]) ?? "TB";
    head.finish();
    // Nodes without a target of their own choose models and interpreters of the plan target.
    if (this.context.planTarget.kind === "local" && fields.executionTarget) {
      this.context = { ...this.context, planTarget: fields.executionTarget };
      this.nodes = new PlanNotationNodeReader(this.context);
    }
    let plan: AgentPlanInput = {
      ...fields,
      name,
      nodes: this.ordered(
        this.nodes.read(planNotationDeclarations(document.statements)),
      ),
      edges: [],
    };
    plan = this.withEdges(plan, edgeStatements(document.statements));
    plan = this.withLoopFields(plan);
    return {
      plan,
      rankdir,
      issues: this.checked(plan, document),
      locations: this.records.locations,
    };
  }

  /** The plan fields; the workspace was resolved before, so its attribute only counts as read. */
  private planFields(
    attributes: PlanNotationAttributes,
    workspaceId: string,
  ): Omit<AgentPlanInput, "name" | "nodes" | "edges"> {
    if (attributes.form(["workspace"], "workspaceId") !== null) {
      attributes.value("workspace");
      attributes.value("workspaceId");
    }
    const written = targetAttribute(attributes, this.context);
    const target = planExecutionTargetSchema.safeParse(written);
    if (written !== undefined && !target.success)
      attributes.invalid("executionTarget");
    return {
      workspaceId,
      usage: attributes.choice("usage", ["private", "workspace"]) ?? "private",
      ...readSharing(attributes),
      ...(target.success ? { executionTarget: target.data } : {}),
      globals: readGlobals(attributes),
    };
  }

  /** Keeps the stored order of the nodes a replaced plan already had; new ones follow in written order. */
  private ordered(nodes: readonly AgentPlanNode[]): AgentPlanNode[] {
    const order = new Map(
      (this.context.previous?.nodes ?? []).map((node, index) => [
        node.id,
        index,
      ]),
    );
    const known = nodes.filter((node) => order.has(node.id));
    const added = nodes.filter((node) => !order.has(node.id));
    known.sort(
      (first, second) =>
        (order.get(first.id) ?? 0) - (order.get(second.id) ?? 0),
    );
    return [...known, ...added];
  }

  private withEdges(
    plan: AgentPlanInput,
    statements: readonly PlanNotationEdgeStatement[],
  ): AgentPlanInput {
    for (const statement of statements) {
      const attributes = new PlanNotationAttributes(
        statement.attributes,
        { nodeId: statement.endpoints[0]?.id ?? null, location: statement },
        this.context.findings,
      );
      const spec = readPlanNotationEdgeSpec(attributes);
      statement.endpoints.slice(1).forEach((target, index) => {
        const source = statement.endpoints[index];
        if (!source) return;
        plan = this.withLink(plan, { source, target, spec });
      });
    }
    return plan;
  }

  private withLink(
    plan: AgentPlanInput,
    link: {
      readonly source: PlanNotationEdgeStatement["endpoints"][number];
      readonly target: PlanNotationEdgeStatement["endpoints"][number];
      readonly spec: ReturnType<typeof readPlanNotationEdgeSpec>;
    },
  ): AgentPlanInput {
    const { source, target } = link;
    if (
      this.records.rejected.has(source.id) ||
      this.records.rejected.has(target.id)
    )
      return plan;
    for (const end of [source, target])
      if (!this.records.locations.has(end.id)) {
        this.context.findings.issues.push(
          planNotationIssue(end, "unknown_node", end.id),
        );
        return plan;
      }
    const result = applyPlanNotationEdge(
      plan,
      { from: source.id, to: target.id },
      { spec: link.spec, agents: this.context.sources.agents },
    );
    if ("plan" in result) return result.plan;
    const location = result.nodeId === target.id ? target : source;
    this.context.findings.issues.push(
      planNotationIssue(location, result.code, result.nodeId),
    );
    return plan;
  }

  /** Gives `mode` and `runsSource` written on a loop precedence over what its data edges implied. */
  private withLoopFields(plan: AgentPlanInput): AgentPlanInput {
    for (const node of plan.nodes) {
      const fields =
        node.type === "loop" ? this.records.loops.get(node.id) : undefined;
      if (node.type === "loop" && fields)
        plan = replacePlanNode(plan, { ...node, ...fields });
    }
    return plan;
  }

  /** Runs the plan reader and the graph check of the save; their findings are `plan_invalid`. */
  private checked(
    plan: AgentPlanInput,
    document: PlanNotationDocument,
  ): readonly PlanNotationIssue[] {
    const issues = this.context.findings.issues;
    if (issues.length > 0) return [...issues];
    try {
      readPlanInput(plan);
    } catch (error: unknown) {
      if (!isPlanReaderRefusal(error)) throw error;
      return [planNotationIssue(document, "plan_invalid")];
    }
    return this.graphIssues(plan, document);
  }

  private graphIssues(
    plan: AgentPlanInput,
    document: PlanNotationDocument,
  ): readonly PlanNotationIssue[] {
    const seen = new Set<string>();
    return planConnectionIssues(plan, this.context.sources.agents).flatMap(
      (issue) => {
        const key = `${issue.nodeId ?? ""}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const location =
          (issue.nodeId === null
            ? undefined
            : this.records.locations.get(issue.nodeId)) ?? document;
        return [planNotationIssue(location, "plan_invalid", issue.nodeId)];
      },
    );
  }
}
