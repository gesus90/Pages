import type { Migration } from "@/backend/database/Migration";

/** The columns of every table as the migrations leave them, in column order. */
export type MigrationSchema = ReadonlyMap<string, readonly string[]>;

const CONSTRAINT_START = /^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i;

/** Splits a column list at its top-level commas. */
function splitDefinitions(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** Finds the closing parenthesis that matches the one at `open`. */
function closingParenthesis(sql: string, open: number): number {
  let depth = 0;
  for (let index = open; index < sql.length; index += 1) {
    if (sql[index] === "(") depth += 1;
    if (sql[index] === ")") depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error("Unbalanced parenthesis in a migration.");
}

function columnName(definition: string): string | null {
  if (CONSTRAINT_START.test(definition)) return null;
  return definition.split(/\s+/)[0].replaceAll('"', "");
}

/**
 * Reads the final table layout out of migration scripts.
 *
 * @param migrations - The scripts, in any order; they are applied in name order.
 * @returns The columns of every table that exists after the last script.
 *
 * @remarks
 * Creating, adding to, dropping from and renaming tables are the only schema
 * statements the migrations use for tables, so a small parser is enough. The
 * test reads the scripts that production applies and opens no database.
 */
export function parseMigrationSchema(
  migrations: readonly Migration[],
): MigrationSchema {
  const tables = new Map<string, string[]>();
  const statements = migrations
    .toSorted((first, second) => first.name.localeCompare(second.name))
    .map(({ sql }) => sql.replace(/--.*$/gm, ""))
    .join("\n");

  const pattern =
    /CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(|ALTER TABLE\s+(\w+)\s+(ADD COLUMN\s+(\w+)|DROP COLUMN\s+(\w+)|RENAME TO\s+(\w+))|DROP TABLE(?: IF EXISTS)?\s+(\w+)/gi;
  for (const match of statements.matchAll(pattern)) {
    const [, created, altered, , added, dropped, renamed, removed] = match;
    if (created) {
      const open = match.index + match[0].length - 1;
      const body = statements.slice(
        open + 1,
        closingParenthesis(statements, open),
      );
      tables.set(
        created,
        splitDefinitions(body).flatMap((definition) => {
          const name = columnName(definition);
          return name === null ? [] : [name];
        }),
      );
    } else if (altered && added) {
      tables.get(altered)?.push(added);
    } else if (altered && dropped) {
      const columns = tables.get(altered) ?? [];
      tables.set(
        altered,
        columns.filter((column) => column !== dropped),
      );
    } else if (altered && renamed) {
      tables.set(renamed, tables.get(altered) ?? []);
      tables.delete(altered);
    } else if (removed) {
      tables.delete(removed);
    }
  }
  return tables;
}
