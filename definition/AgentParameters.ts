export type AgentParameterType = "text" | "workspace" | "wiki";

/** Reference defaults retain identifiers, never copied paths or wiki content. */
export type AgentParameterValue =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "workspace"; readonly workspaceId: string }
  | { readonly type: "wiki"; readonly pageId: string };

/** Template declarations are independent of concrete values bound by a later plan step. */
export interface AgentParameter {
  readonly name: string;
  readonly type: AgentParameterType;
  readonly description: string;
  readonly isRequired: boolean;
  readonly defaultValue: AgentParameterValue | null;
}

export interface AgentPlaceholder {
  readonly name: string;
  readonly type: AgentParameterType;
  readonly property: "text" | "path" | "link" | "markdown";
  readonly start: number;
  readonly end: number;
}

export type AgentParameterIssue =
  "syntax" | "undeclared" | "typeMismatch" | "duplicate" | "directory";

const PARAMETER_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const PLACEHOLDER_PROPERTIES = {
  text: "text",
  path: "workspace",
  link: "wiki",
  markdown: "wiki",
} as const;

/** Names are case-sensitive identifiers, without dots or expression syntax. */
export function isAgentParameterName(name: string): boolean {
  return PARAMETER_NAME.test(name);
}

function isEscaped(markdown: string, start: number): boolean {
  let backslashes = 0;
  for (let index = start - 1; index >= 0 && markdown[index] === "\\"; index--)
    backslashes++;
  return backslashes % 2 === 1;
}

function placeholder(
  token: string,
  start: number,
  end: number,
): AgentPlaceholder | null {
  const parts = token.split(".");
  const name = parts[0];
  const property = parts[1] ?? "text";
  if (!isAgentParameterName(name) || parts.length > 2) return null;
  if (
    property !== "text" &&
    property !== "path" &&
    property !== "link" &&
    property !== "markdown"
  )
    return null;
  if (parts.length === 2 && property === "text") return null;
  return { name, property, type: PLACEHOLDER_PROPERTIES[property], start, end };
}

/** Scans once; escaped openings stay literal and substitutions are never recursive. */
export function scanAgentPlaceholders(markdown: string): {
  readonly placeholders: readonly AgentPlaceholder[];
  readonly hasInvalidSyntax: boolean;
} {
  const placeholders: AgentPlaceholder[] = [];
  let hasInvalidSyntax = false;
  const openings = /\{\{/g;
  for (const match of markdown.matchAll(openings)) {
    if (isEscaped(markdown, match.index)) continue;
    const closing = markdown.indexOf("}}", match.index + 2);
    const found = placeholder(
      markdown.slice(match.index + 2, closing),
      match.index,
      closing + 2,
    );
    if (closing < 0 || found === null) hasInvalidSyntax = true;
    else placeholders.push(found);
  }
  return { placeholders, hasInvalidSyntax };
}

/** Checks declared types and explicit directory use before enabling an agent. */
export function agentParameterIssues(input: {
  readonly markdown: string;
  readonly parameters: readonly AgentParameter[];
  readonly directoryParameter: string | null;
}): readonly AgentParameterIssue[] {
  const issues = new Set<AgentParameterIssue>();
  const scanned = scanAgentPlaceholders(input.markdown);
  if (scanned.hasInvalidSyntax) issues.add("syntax");
  const declarations = new Map(
    input.parameters.map((entry) => [entry.name, entry]),
  );
  if (declarations.size !== input.parameters.length) issues.add("duplicate");
  for (const entry of scanned.placeholders) {
    const declared = declarations.get(entry.name);
    if (!declared) issues.add("undeclared");
    else if (declared.type !== entry.type) issues.add("typeMismatch");
  }
  if (
    input.directoryParameter !== null &&
    declarations.get(input.directoryParameter)?.type !== "workspace"
  )
    issues.add("directory");
  return [...issues];
}
