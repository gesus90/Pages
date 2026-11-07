import { readPlanNotationTokens } from "./PlanNotationLexer";
import { PlanNotationError, planNotationIssue } from "./PlanNotationIssue";
import { PLAN_NOTATION_KEYWORDS } from "./PlanNotationVocabulary";

import type { PlanNotationToken } from "./PlanNotationLexer";
import type {
  PlanNotationIssueCode,
  PlanNotationLocation,
} from "./PlanNotationIssue";

/** The prefix that makes a DOT subgraph a group or loop of the plan. */
export const PLAN_NOTATION_CLUSTER_PREFIX = "cluster_";

/** A value as written: an identifier, a number or a quoted text. */
export interface PlanNotationValue extends PlanNotationLocation {
  readonly kind: "identifier" | "number" | "string";
  readonly text: string;
}

/** One `key=value` pair, of an attribute list or a statement of its own. */
export interface PlanNotationAttribute extends PlanNotationLocation {
  readonly key: string;
  readonly value: PlanNotationValue;
}

/** A node with its attributes: `id [a=b, …]`. */
export interface PlanNotationNodeStatement extends PlanNotationLocation {
  readonly kind: "node";
  readonly id: string;
  readonly attributes: readonly PlanNotationAttribute[];
}

/** One end of an edge chain. */
export interface PlanNotationEndpoint extends PlanNotationLocation {
  readonly id: string;
}

/** A chain `a -> b -> c [a=b]`; every link of it carries the attributes. */
export interface PlanNotationEdgeStatement extends PlanNotationLocation {
  readonly kind: "edge";
  readonly endpoints: readonly PlanNotationEndpoint[];
  readonly attributes: readonly PlanNotationAttribute[];
}

/** An attribute of the graph or subgraph it stands in. */
export interface PlanNotationAssignment extends PlanNotationLocation {
  readonly kind: "assignment";
  readonly attribute: PlanNotationAttribute;
}

/** `subgraph cluster_<id> { … }`: a group or loop with the identifier `<id>`. */
export interface PlanNotationSubgraph extends PlanNotationLocation {
  readonly kind: "subgraph";
  readonly id: string;
  readonly statements: readonly PlanNotationStatement[];
}

/** One statement of a graph or subgraph. */
export type PlanNotationStatement =
  | PlanNotationNodeStatement
  | PlanNotationEdgeStatement
  | PlanNotationAssignment
  | PlanNotationSubgraph;

/** A whole notation: one `digraph` with its name and statements. */
export interface PlanNotationDocument extends PlanNotationLocation {
  readonly name: string | null;
  readonly statements: readonly PlanNotationStatement[];
}

function isKeyword(token: PlanNotationToken, keyword: string): boolean {
  return token.kind === "identifier" && token.text.toLowerCase() === keyword;
}

function isAnyKeyword(token: PlanNotationToken): boolean {
  return PLAN_NOTATION_KEYWORDS.some((keyword) => isKeyword(token, keyword));
}

/** Reads the token list of a notation into its statements; the first finding stops it. */
class PlanNotationReader {
  private readonly tokens: readonly PlanNotationToken[];
  private index = 0;

  public constructor(tokens: readonly PlanNotationToken[]) {
    this.tokens = tokens;
  }

  /** Reads `digraph name? { … }` and requires nothing after it. */
  public document(): PlanNotationDocument {
    const start = this.peek();
    if (isKeyword(start, "strict") || isKeyword(start, "graph"))
      this.fail(start, "unsupported_element");
    if (!isKeyword(start, "digraph")) this.fail(start);
    this.advance();
    const name = this.isPunctuation("{") ? null : this.identifier().text;
    const statements = this.block();
    if (this.peek().kind !== "end") this.fail(this.peek());
    return { line: start.line, column: start.column, name, statements };
  }

  private peek(offset = 0): PlanNotationToken {
    return (
      this.tokens[Math.min(this.index + offset, this.tokens.length - 1)] ??
      this.fail({ line: 1, column: 1 })
    );
  }

  private advance(): PlanNotationToken {
    const token = this.peek();
    if (token.kind !== "end") this.index += 1;
    return token;
  }

  private fail(
    location: PlanNotationLocation,
    code: PlanNotationIssueCode = "syntax",
  ): never {
    throw new PlanNotationError([planNotationIssue(location, code)]);
  }

  private isPunctuation(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === "punctuation" && token.text === text;
  }

  private expect(text: string): PlanNotationToken {
    if (!this.isPunctuation(text)) this.fail(this.peek());
    return this.advance();
  }

  /** An identifier, number or text that names something; keywords name nothing. */
  private identifier(): PlanNotationValue {
    const token = this.peek();
    if (
      (token.kind !== "identifier" &&
        token.kind !== "number" &&
        token.kind !== "string") ||
      isAnyKeyword(token)
    )
      this.fail(token);
    this.advance();
    return {
      line: token.line,
      column: token.column,
      kind: token.kind,
      text: token.text,
    };
  }

  /** `{ statement* }` with optional `;` between statements. */
  private block(): readonly PlanNotationStatement[] {
    this.expect("{");
    const statements: PlanNotationStatement[] = [];
    while (!this.isPunctuation("}")) {
      if (this.peek().kind === "end") this.fail(this.peek());
      statements.push(this.statement());
      while (this.isPunctuation(";")) this.advance();
    }
    this.advance();
    return statements;
  }

  private statement(): PlanNotationStatement {
    const token = this.peek();
    if (isKeyword(token, "subgraph")) return this.subgraph();
    if (
      isKeyword(token, "node") ||
      isKeyword(token, "edge") ||
      isKeyword(token, "graph") ||
      this.isPunctuation("{")
    )
      this.fail(token, "unsupported_element");
    const first = this.identifier();
    if (this.isPunctuation("=")) {
      this.advance();
      return {
        kind: "assignment",
        line: first.line,
        column: first.column,
        attribute: {
          key: first.text,
          line: first.line,
          column: first.column,
          value: this.identifier(),
        },
      };
    }
    if (this.isPunctuation("->")) return this.edge(first);
    this.refuseForeignSyntax();
    return {
      kind: "node",
      id: first.text,
      line: first.line,
      column: first.column,
      attributes: this.attributeLists(),
    };
  }

  /** Undirected edges and ports belong to DOT, not to the notation. */
  private refuseForeignSyntax(): void {
    if (this.isPunctuation("--") || this.isPunctuation(":"))
      this.fail(this.peek(), "unsupported_element");
  }

  private edge(first: PlanNotationValue): PlanNotationEdgeStatement {
    const endpoints: PlanNotationEndpoint[] = [
      { id: first.text, line: first.line, column: first.column },
    ];
    while (this.isPunctuation("->")) {
      this.advance();
      if (isKeyword(this.peek(), "subgraph") || this.isPunctuation("{"))
        this.fail(this.peek(), "unsupported_element");
      const next = this.identifier();
      endpoints.push({ id: next.text, line: next.line, column: next.column });
    }
    this.refuseForeignSyntax();
    return {
      kind: "edge",
      line: first.line,
      column: first.column,
      endpoints,
      attributes: this.attributeLists(),
    };
  }

  private subgraph(): PlanNotationSubgraph {
    const start = this.advance();
    if (this.isPunctuation("{")) this.fail(start, "unsupported_element");
    const name = this.identifier();
    if (
      !name.text.startsWith(PLAN_NOTATION_CLUSTER_PREFIX) ||
      name.text.length === PLAN_NOTATION_CLUSTER_PREFIX.length
    )
      this.fail(name, "unsupported_element");
    return {
      kind: "subgraph",
      id: name.text.slice(PLAN_NOTATION_CLUSTER_PREFIX.length),
      line: start.line,
      column: start.column,
      statements: this.block(),
    };
  }

  /** Any number of `[a=b, c=d; …]` lists, read as one. */
  private attributeLists(): readonly PlanNotationAttribute[] {
    const attributes: PlanNotationAttribute[] = [];
    while (this.isPunctuation("[")) {
      this.advance();
      while (!this.isPunctuation("]")) {
        const key = this.identifier();
        this.expect("=");
        attributes.push({
          key: key.text,
          line: key.line,
          column: key.column,
          value: this.identifier(),
        });
        if (this.isPunctuation(",") || this.isPunctuation(";")) this.advance();
      }
      this.advance();
    }
    return attributes;
  }
}

/**
 * Reads a plan notation, a subset of Graphviz DOT, into its statements.
 *
 * @param source - The notation: exactly one `digraph`.
 * @returns The document; names and values are not resolved yet.
 * @throws {PlanNotationError} With one finding: `syntax`, or
 * `unsupported_element` for `strict`, `graph`, `node [...]`, `edge [...]`,
 * undirected edges, ports, anonymous subgraphs, subgraphs that are no
 * cluster and HTML labels.
 */
export function readPlanNotationDocument(source: string): PlanNotationDocument {
  return new PlanNotationReader(readPlanNotationTokens(source)).document();
}
