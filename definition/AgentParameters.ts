export type AgentParameterType =
  "text" | "number" | "ticket" | "workspace" | "wiki";

/** Reference defaults retain identifiers, never copied paths or wiki content. */
export type AgentParameterValue =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "number"; readonly number: number }
  | { readonly type: "ticket"; readonly ticketId: string }
  | { readonly type: "workspace"; readonly workspaceId: string }
  | { readonly type: "wiki"; readonly pageId: string };

/** The authorized ticket projection offered by parameter pickers. */
export interface AgentTicketChoice {
  readonly id: string;
  readonly key: string;
  readonly title: string;
}

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
  readonly property:
    "text" | "path" | "link" | "markdown" | "description" | "assets";
  readonly start: number;
  readonly end: number;
}

export type AgentParameterIssue =
  | "unsupportedRunNotes"
  | "syntax"
  | "undeclared"
  | "typeMismatch"
  | "duplicate"
  | "directory"
  | "number";

const PARAMETER_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const PLACEHOLDER_PROPERTIES = {
  text: "text",
  path: "workspace",
  link: "wiki",
  markdown: "wiki",
  description: "ticket",
  assets: "ticket",
} as const;

/** Names are case-sensitive identifiers, without dots or expression syntax. */
export function isAgentParameterName(name: string): boolean {
  return PARAMETER_NAME.test(name);
}

/** Checks whether a typed value supplies usable input, including zero as a valid number. */
export function hasAgentParameterValue(
  value: AgentParameterValue | null,
): boolean {
  if (value === null) return false;
  switch (value.type) {
    case "text":
      return Boolean(value.text.trim());
    case "number":
      return Number.isFinite(value.number);
    case "ticket":
      return Boolean(value.ticketId.trim());
    case "workspace":
      return Boolean(value.workspaceId.trim());
    case "wiki":
      return Boolean(value.pageId.trim());
  }
}

function hasInvalidNumber(parameters: readonly AgentParameter[]): boolean {
  return parameters.some(
    (parameter) =>
      parameter.defaultValue?.type === "number" &&
      !Number.isFinite(parameter.defaultValue.number),
  );
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
    property !== "markdown" &&
    property !== "description" &&
    property !== "assets"
  )
    return null;
  if (parts.length === 2 && property === "text") return null;
  return { name, property, type: PLACEHOLDER_PROPERTIES[property], start, end };
}

/** Scans once; escaped openings stay literal and substitutions are never recursive. */
export function scanAgentPlaceholders(markdown: string): {
  readonly placeholders: readonly AgentPlaceholder[];
  readonly hasUnsupportedRunNotes: boolean;
  readonly hasInvalidSyntax: boolean;
} {
  const placeholders: AgentPlaceholder[] = [];
  let hasUnsupportedRunNotes = false;
  let hasInvalidSyntax = false;
  const openings = /\{\{/g;
  for (const match of markdown.matchAll(openings)) {
    if (isEscaped(markdown, match.index)) continue;
    const closing = markdown.indexOf("}}", match.index + 2);
    const token = markdown.slice(match.index + 2, closing);
    if (closing >= 0 && token === "@run.notes") {
      hasUnsupportedRunNotes = true;
      continue;
    }
    const found = placeholder(token, match.index, closing + 2);
    if (closing < 0 || found === null) hasInvalidSyntax = true;
    else placeholders.push(found);
  }
  return { placeholders, hasUnsupportedRunNotes, hasInvalidSyntax };
}

/**
 * The parameters a template really names, read with the one placeholder scanner.
 *
 * @param markdown - A template such as a node's `AGENT.md`.
 * @returns The names of its placeholders, such as `ergebnis` for
 * `{{ergebnis}}`; escaped placeholders do not count.
 */
export function placeholderNames(markdown: string): ReadonlySet<string> {
  return new Set(
    scanAgentPlaceholders(markdown).placeholders.map((found) => found.name),
  );
}

/** Checks declared types and explicit directory use before enabling an agent. */
export function agentParameterIssues(input: {
  readonly markdown: string;
  readonly parameters: readonly AgentParameter[];
  readonly directoryParameter: string | null;
}): readonly AgentParameterIssue[] {
  const issues = new Set<AgentParameterIssue>();
  const scanned = scanAgentPlaceholders(input.markdown);
  if (scanned.hasUnsupportedRunNotes) issues.add("unsupportedRunNotes");
  if (scanned.hasInvalidSyntax) issues.add("syntax");
  const declarations = new Map(
    input.parameters.map((entry) => [entry.name, entry]),
  );
  if (declarations.size !== input.parameters.length) issues.add("duplicate");
  for (const entry of scanned.placeholders) {
    const declared = declarations.get(entry.name);
    if (!declared) issues.add("undeclared");
    else if (
      declared.type !== entry.type &&
      !(
        entry.property === "text" &&
        (declared.type === "number" || declared.type === "ticket")
      )
    )
      issues.add("typeMismatch");
  }
  if (hasInvalidNumber(input.parameters)) issues.add("number");
  if (
    input.directoryParameter !== null &&
    declarations.get(input.directoryParameter)?.type !== "workspace"
  )
    issues.add("directory");
  return [...issues];
}
