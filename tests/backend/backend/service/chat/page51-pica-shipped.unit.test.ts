import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { describeChatOperations } from "@/backend/service/chat/ChatToolCatalog";
import {
  PICA_INSTRUCTION_DIRECTORY,
  readPicaInstructions,
} from "@/backend/service/chat/PicaInstructionFiles";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../../..");

/** Production sources, including the independent MCP package, read as text only. */
const SOURCE_ROOTS = ["app", "backend", "definition", "language", "mcp/src"];

const LOADER = "backend/service/chat/PicaInstructionFiles.ts";

const LOADER_IMPORT =
  /import\s+(type\s+)?\{[^}]*\}\s+from\s+["']([^"']*\/PicaInstructionFiles)["']/gu;

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(REPOSITORY_ROOT, directory), {
    recursive: true,
    encoding: "utf8",
  })
    .filter((file) => /\.tsx?$/u.test(file))
    .map((file) => path.join(directory, file))
    .filter((file) => statSync(path.join(REPOSITORY_ROOT, file)).isFile());
}

function source(file: string): string {
  return readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

const SOURCES = SOURCE_ROOTS.flatMap(sourceFiles);

describe("the shipped files", () => {
  it("hold Pica's identity and tone in SOUL.md and tasks and rules in AGENTS.md", async () => {
    const logged = vi.spyOn(console, "error");

    const instructions = await readPicaInstructions();

    expect(logged).not.toHaveBeenCalled();
    expect(instructions.soul.startsWith("# Pica\n")).toBe(true);
    expect(instructions.soul).toContain("## Sprache und Ton");
    for (const heading of [
      "## Aufgaben",
      "## Arbeitsweise",
      "## Grenzen",
      "## Deine Vorgaben",
    ])
      expect(instructions.agents).toContain(heading);
    // They hold no server path, which the instruction must never reveal.
    expect(`${instructions.soul}${instructions.agents}`).not.toMatch(
      /\/home\/|\/srv\/|\.pages\//u,
    );
    expect(readdirSync(PICA_INSTRUCTION_DIRECTORY).sort()).toEqual([
      "AGENTS.md",
      "SOUL.md",
    ]);
  });
});

describe("the boundary of the files", () => {
  it("lets only the Pica chat composition load them", () => {
    const runtimeImports: string[] = [];
    const typeImports: string[] = [];
    for (const file of SOURCES)
      for (const match of source(file).matchAll(LOADER_IMPORT))
        (match[1] ? typeImports : runtimeImports).push(file);

    expect(runtimeImports).toEqual(["app/lib/chat-services.server.ts"]);
    expect(typeImports.sort()).toEqual([
      "backend/service/chat/ChatPrompt.ts",
      "backend/service/chat/ChatService.ts",
    ]);
  });

  it("keeps their directory out of every other production source, MCP included", () => {
    const naming = SOURCES.filter((file) =>
      /PICA_INSTRUCTION_DIRECTORY|\/pica\/["'`]/u.test(source(file)),
    );

    expect(naming).toEqual([LOADER]);
  });

  it("offers Pica no action on files, chat settings or its own instructions", () => {
    const operations = describeChatOperations()
      .split("\n")
      .map((line) => /^- `([^`]+)`/u.exec(line)?.[1] ?? "");

    expect(operations.length).toBeGreaterThan(50);
    expect(operations).not.toContain("");
    expect(
      operations.filter((operation) =>
        /^(?:files?|chat|settings|pica|instructions?|soul|system)\./u.test(
          operation,
        ),
      ),
    ).toEqual([]);
  });
});
