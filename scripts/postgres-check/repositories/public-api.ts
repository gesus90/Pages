import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const REPOSITORIES = fileURLToPath(
  new URL("../../../backend/database/repositories/", import.meta.url),
);

/** The directories of the ported area, with the files directly below `repositories/` as the empty name. */
const AREA_DIRECTORIES = [
  "",
  "agent",
  "agents",
  "chat",
  "discord",
  "mcp",
  "mobile",
  "project",
  "remote",
  "runner",
  "task",
  "wiki",
] as const;

/** What the area offers to other code. */
export interface PublicApi {
  /** Public methods per exported class. */
  readonly methods: ReadonlyMap<string, readonly string[]>;
  /** Exported functions. */
  readonly functions: readonly string[];
  /** The files read, for the summary of the check. */
  readonly files: readonly string[];
}

function hasModifier(node: ts.HasModifiers, kind: ts.SyntaxKind): boolean {
  return ts.getModifiers(node)?.some((item) => item.kind === kind) ?? false;
}

function publicMethodsOf(node: ts.ClassDeclaration): readonly string[] {
  return node.members.flatMap((member) =>
    ts.isMethodDeclaration(member) &&
    hasModifier(member, ts.SyntaxKind.PublicKeyword) &&
    !hasModifier(member, ts.SyntaxKind.StaticKeyword)
      ? [member.name.getText()]
      : [],
  );
}

function readExports(
  source: ts.SourceFile,
  methods: Map<string, readonly string[]>,
  functions: string[],
): void {
  for (const statement of source.statements) {
    if (!ts.canHaveModifiers(statement)) continue;
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isClassDeclaration(statement) && statement.name)
      methods.set(statement.name.text, publicMethodsOf(statement));
    if (ts.isFunctionDeclaration(statement) && statement.name)
      functions.push(statement.name.text);
  }
}

/**
 * Reads the public methods and functions of the area from its source.
 *
 * @returns The classes with their public methods and the exported functions.
 *
 * @remarks
 * The source decides, not a list in this check: a new public method that no
 * step calls makes the check fail.
 */
export async function readPublicApi(): Promise<PublicApi> {
  const methods = new Map<string, readonly string[]>();
  const functions: string[] = [];
  const files: string[] = [];
  for (const directory of AREA_DIRECTORIES) {
    const root = path.join(REPOSITORIES, directory);
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const text = await readFile(path.join(root, entry.name), "utf8");
      files.push(path.join(directory, entry.name));
      readExports(
        ts.createSourceFile(entry.name, text, ts.ScriptTarget.Latest, true),
        methods,
        functions,
      );
    }
  }
  return { methods, functions, files };
}
