/** One condition of a Drive `q` search the simulation understands. */
export type SimulatedQueryClause =
  | { readonly kind: "in_parents"; readonly id: string }
  | { readonly kind: "trashed"; readonly isTrashed: boolean }
  | {
      readonly kind: "mime_type";
      readonly mimeType: string;
      readonly isNegated: boolean;
    }
  | { readonly kind: "name_equals"; readonly name: string }
  | { readonly kind: "name_contains"; readonly text: string }
  | { readonly kind: "full_text"; readonly text: string };

const LITERAL = String.raw`'((?:[^'\\]|\\.)*)'`;
const IN_PARENTS = new RegExp(String.raw`^${LITERAL}\s+in\s+parents$`, "u");
const TRASHED = /^trashed\s*=\s*(true|false)$/u;
const MIME_TYPE = new RegExp(String.raw`^mimeType\s*(=|!=)\s*${LITERAL}$`, "u");
const NAME_EQUALS = new RegExp(String.raw`^name\s*=\s*${LITERAL}$`, "u");
const NAME_CONTAINS = new RegExp(
  String.raw`^name\s+contains\s+${LITERAL}$`,
  "u",
);
const FULL_TEXT = new RegExp(
  String.raw`^fullText\s+contains\s+${LITERAL}$`,
  "u",
);

function unescape(text: string): string {
  return text.replace(/\\(.)/gu, "$1");
}

/** Splits at ` and ` outside of quoted literals. */
function splitClauses(query: string): string[] {
  const clauses: string[] = [];
  let current = "";
  let isQuoted = false;

  for (let index = 0; index < query.length; index += 1) {
    const character = query.charAt(index);

    if (isQuoted && character === "\\") {
      current += character + query.charAt(index + 1);
      index += 1;
      continue;
    }

    if (character === "'") {
      isQuoted = !isQuoted;
    }

    if (!isQuoted && query.startsWith(" and ", index)) {
      clauses.push(current.trim());
      current = "";
      index += 4;
      continue;
    }

    current += character;
  }

  clauses.push(current.trim());

  return clauses;
}

function parseClause(clause: string): SimulatedQueryClause | null {
  const inParents = IN_PARENTS.exec(clause);

  if (inParents?.[1] !== undefined) {
    return { id: unescape(inParents[1]), kind: "in_parents" };
  }

  const trashed = TRASHED.exec(clause);

  if (trashed?.[1] !== undefined) {
    return { isTrashed: trashed[1] === "true", kind: "trashed" };
  }

  const mimeType = MIME_TYPE.exec(clause);

  if (mimeType?.[2] !== undefined) {
    return {
      isNegated: mimeType[1] === "!=",
      kind: "mime_type",
      mimeType: unescape(mimeType[2]),
    };
  }

  const nameEquals = NAME_EQUALS.exec(clause);

  if (nameEquals?.[1] !== undefined) {
    return { kind: "name_equals", name: unescape(nameEquals[1]) };
  }

  const nameContains = NAME_CONTAINS.exec(clause);

  if (nameContains?.[1] !== undefined) {
    return { kind: "name_contains", text: unescape(nameContains[1]) };
  }

  const fullText = FULL_TEXT.exec(clause);

  return fullText?.[1] === undefined
    ? null
    : { kind: "full_text", text: unescape(fullText[1]) };
}

/**
 * Parses the subset of Drive's `q` syntax the Pages clients send.
 *
 * @param query - The `q` parameter; empty means every entry.
 * @returns The conditions, all of which must hold, or `null` for syntax the
 * simulation does not know, which it answers with Drive's `invalid` error.
 */
export function parseSimulatedQuery(
  query: string,
): SimulatedQueryClause[] | null {
  if (query.trim() === "") {
    return [];
  }

  const clauses = splitClauses(query).map(parseClause);

  return clauses.every((clause) => clause !== null) ? clauses : null;
}
