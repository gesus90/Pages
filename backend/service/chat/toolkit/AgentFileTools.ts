import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { Dirent } from "node:fs";

import { z } from "zod";

import { defineToolkitTool } from "./AgentToolkitContracts";
import {
  UNTRUSTED_CONTENT_NOTE,
  toolkitFailure,
  toolkitRefusal,
  toolkitResult,
} from "./AgentToolkitOutcome";
import { relativeToolkitPath, resolveToolkitPath } from "./AgentToolkitPaths";

import type {
  AgentToolkitJob,
  AgentToolkitTool,
} from "./AgentToolkitContracts";

/** Bytes of a file the agent reads or searches at most. */
const MAXIMUM_FILE_BYTES = 1_000_000;
/** Characters a read returns at most. */
const MAXIMUM_READ_CHARACTERS = 100_000;
/** Bytes a write stores at most. */
const MAXIMUM_WRITE_CHARACTERS = 1_000_000;
/** Entries a listing returns at most. */
const MAXIMUM_ENTRIES = 500;
/** Matches a search returns at most. */
const MAXIMUM_MATCHES = 200;
/** Folders a listing or search never enters. */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([".git", "node_modules"]);

const filePath = z.string().min(1).max(4_096);

const READ_SCHEMA = z
  .object({
    path: filePath,
    offset: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

const LIST_SCHEMA = z
  .object({
    path: filePath.optional(),
    depth: z.number().int().min(1).max(5).optional(),
  })
  .strict();

const SEARCH_SCHEMA = z
  .object({
    text: z.string().min(1).max(500),
    path: filePath.optional(),
    isRegex: z.boolean().optional(),
    fileName: z.string().min(1).max(200).optional(),
  })
  .strict();

const WRITE_SCHEMA = z
  .object({
    path: filePath,
    content: z.string().max(MAXIMUM_WRITE_CHARACTERS),
  })
  .strict();

const EDIT_SCHEMA = z
  .object({
    path: filePath,
    oldText: z.string().min(1).max(MAXIMUM_WRITE_CHARACTERS),
    newText: z.string().max(MAXIMUM_WRITE_CHARACTERS),
    replaceAll: z.boolean().optional(),
  })
  .strict();

const DELETE_SCHEMA = z.object({ path: filePath }).strict();

interface ListedEntry {
  readonly path: string;
  readonly type: "file" | "folder" | "other";
  readonly size: number | null;
}

/** Reads a text file of the working folder, refusing large or binary files. */
async function readTextFile(file: string): Promise<string | null> {
  const facts = await stat(file);
  if (!facts.isFile() || facts.size > MAXIMUM_FILE_BYTES) return null;
  const bytes = await readFile(file);
  return bytes.includes(0) ? null : bytes.toString("utf8");
}

function entryType(entry: Dirent): ListedEntry["type"] {
  if (entry.isDirectory()) return "folder";
  return entry.isFile() ? "file" : "other";
}

async function listFolder(
  root: string,
  folder: string,
  depth: number,
): Promise<ListedEntry[]> {
  const entries: ListedEntry[] = [];
  const pending: { readonly folder: string; readonly level: number }[] = [
    { folder, level: 1 },
  ];
  while (pending.length > 0 && entries.length < MAXIMUM_ENTRIES) {
    const next = pending.shift();
    if (!next) break;
    const children = await readdir(next.folder, { withFileTypes: true });
    for (const child of children.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (entries.length >= MAXIMUM_ENTRIES) break;
      const absolute = path.join(next.folder, child.name);
      const type = entryType(child);
      const size = type === "file" ? (await stat(absolute)).size : null;
      entries.push({ path: relativeToolkitPath(root, absolute), type, size });
      if (
        type === "folder" &&
        next.level < depth &&
        !SKIPPED_FOLDERS.has(child.name)
      )
        pending.push({ folder: absolute, level: next.level + 1 });
    }
  }
  return entries;
}

/** Every file below a folder, without the skipped folders and links. */
async function filesBelow(folder: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [folder];
  while (pending.length > 0 && files.length < 10_000) {
    const next = pending.shift();
    if (next === undefined) break;
    for (const child of await readdir(next, { withFileTypes: true })) {
      const absolute = path.join(next, child.name);
      if (child.isDirectory() && !SKIPPED_FOLDERS.has(child.name))
        pending.push(absolute);
      else if (child.isFile()) files.push(absolute);
    }
  }
  return files.sort();
}

function matcher(text: string, isRegex: boolean): (line: string) => boolean {
  if (!isRegex) return (line) => line.includes(text);
  const expression = new RegExp(text, "u");
  return (line) => expression.test(line);
}

/** The real working folder; a path inside it is shown relative to it, every other one absolute. */
async function realRoot(job: AgentToolkitJob): Promise<string> {
  return await resolveToolkitPath(job.root, ".", job.protectedDirectories);
}

async function readFileTool(
  parameters: z.infer<typeof READ_SCHEMA>,
  job: AgentToolkitJob,
): Promise<ReturnType<typeof toolkitResult>> {
  const file = await resolveToolkitPath(
    job.root,
    parameters.path,
    job.protectedDirectories,
  );
  const text = await readTextFile(file);
  if (text === null) return toolkitRefusal("NOT_A_TEXT_FILE");
  const lines = text.split("\n");
  const start = (parameters.offset ?? 1) - 1;
  const selected = lines.slice(start, start + (parameters.limit ?? 2_000));
  const content = selected.join("\n");
  return toolkitResult({
    path: relativeToolkitPath(await realRoot(job), file),
    firstLine: start + 1,
    totalLines: lines.length,
    content: content.slice(0, MAXIMUM_READ_CHARACTERS),
    isTruncated:
      content.length > MAXIMUM_READ_CHARACTERS ||
      start + selected.length < lines.length,
    note: UNTRUSTED_CONTENT_NOTE,
  });
}

async function searchFilesTool(
  parameters: z.infer<typeof SEARCH_SCHEMA>,
  job: AgentToolkitJob,
): Promise<ReturnType<typeof toolkitResult>> {
  const root = await realRoot(job);
  const folder = await resolveToolkitPath(
    job.root,
    parameters.path ?? ".",
    job.protectedDirectories,
  );
  let isMatch: (line: string) => boolean;
  try {
    isMatch = matcher(parameters.text, parameters.isRegex === true);
  } catch {
    return toolkitRefusal("INVALID_PATTERN");
  }
  const matches: { path: string; line: number; text: string }[] = [];
  for (const file of await filesBelow(folder)) {
    if (matches.length >= MAXIMUM_MATCHES) break;
    if (
      parameters.fileName &&
      !path.basename(file).includes(parameters.fileName)
    )
      continue;
    const text = await readTextFile(file);
    if (text === null) continue;
    text.split("\n").forEach((line, index) => {
      if (matches.length < MAXIMUM_MATCHES && isMatch(line))
        matches.push({
          path: relativeToolkitPath(root, file),
          line: index + 1,
          text: line.slice(0, 500),
        });
    });
  }
  return toolkitResult({
    matches,
    isTruncated: matches.length >= MAXIMUM_MATCHES,
    note: UNTRUSTED_CONTENT_NOTE,
  });
}

async function editFileTool(
  parameters: z.infer<typeof EDIT_SCHEMA>,
  job: AgentToolkitJob,
): Promise<ReturnType<typeof toolkitResult>> {
  const file = await resolveToolkitPath(
    job.root,
    parameters.path,
    job.protectedDirectories,
  );
  const text = await readTextFile(file);
  if (text === null) return toolkitRefusal("NOT_A_TEXT_FILE");
  const count = text.split(parameters.oldText).length - 1;
  if (count === 0) return toolkitRefusal("TEXT_NOT_FOUND");
  if (count > 1 && parameters.replaceAll !== true)
    return toolkitRefusal("TEXT_NOT_UNIQUE", { occurrences: count });
  const changed =
    parameters.replaceAll === true
      ? text.split(parameters.oldText).join(parameters.newText)
      : text.replace(parameters.oldText, () => parameters.newText);
  await writeFile(file, changed, "utf8");
  return toolkitResult({
    path: relativeToolkitPath(await realRoot(job), file),
    replaced: parameters.replaceAll === true ? count : 1,
  });
}

/** Runs a file tool and turns path and file system failures into refusals. */
function guarded<Input>(
  run: (
    parameters: Input,
    job: AgentToolkitJob,
  ) => Promise<ReturnType<typeof toolkitResult>>,
): (
  parameters: Input,
  job: AgentToolkitJob,
) => Promise<ReturnType<typeof toolkitResult>> {
  return async (parameters, job) => {
    try {
      return await run(parameters, job);
    } catch (error: unknown) {
      return toolkitFailure(error);
    }
  };
}

/**
 * The file tools of the toolkit: read, list and search in both modes, write,
 * change and delete only in YOLO.
 * @remarks
 * A relative path starts at the working folder of the job; an absolute path
 * reaches the whole host as far as the account's Linux rights allow. In
 * "Lesend" the instance folders of Pages stay out of reach, also through a
 * link, with `PROTECTED_PATH`. Deleting is a consequential step the person
 * approves first.
 */
export const AGENT_FILE_TOOLS: readonly AgentToolkitTool[] = [
  defineToolkitTool({
    id: "datei_lesen",
    group: "files",
    isWrite: false,
    description: `Read a text file. path is relative to your working folder or absolute anywhere on the host; offset (first line, from 1) and limit (lines, default 2000) read a part of a long file. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: READ_SCHEMA,
    execute: guarded(readFileTool),
  }),
  defineToolkitTool({
    id: "ordner_auflisten",
    group: "files",
    isWrite: false,
    description:
      "List a folder, relative to your working folder or absolute: path (default the working folder) and depth (1 to 5, default 1). Returns path, type and size of each entry, at most 500.",
    inputSchema: LIST_SCHEMA,
    execute: guarded(async (parameters, job) => {
      const root = await realRoot(job);
      const folder = await resolveToolkitPath(
        job.root,
        parameters.path ?? ".",
        job.protectedDirectories,
      );
      const entries = await listFolder(root, folder, parameters.depth ?? 1);
      return toolkitResult({
        entries,
        isTruncated: entries.length >= MAXIMUM_ENTRIES,
      });
    }),
  }),
  defineToolkitTool({
    id: "dateien_suchen",
    group: "files",
    isWrite: false,
    description: `Search the text files below a folder (relative to your working folder or absolute) for a text (isRegex: true for a regular expression); fileName keeps files whose name contains it. Returns path, line and text of each match, at most 200. ${UNTRUSTED_CONTENT_NOTE}`,
    inputSchema: SEARCH_SCHEMA,
    execute: guarded(searchFilesTool),
  }),
  defineToolkitTool({
    id: "datei_schreiben",
    group: "files",
    isWrite: true,
    description:
      "Write a text file with the complete content; path is relative to your working folder or absolute; missing folders are created, an existing file is replaced.",
    inputSchema: WRITE_SCHEMA,
    execute: guarded(async (parameters, job) => {
      const file = await resolveToolkitPath(
        job.root,
        parameters.path,
        job.protectedDirectories,
      );
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, parameters.content, "utf8");
      return toolkitResult({
        path: relativeToolkitPath(await realRoot(job), file),
        characters: parameters.content.length,
      });
    }),
  }),
  defineToolkitTool({
    id: "datei_aendern",
    group: "files",
    isWrite: true,
    description:
      "Change a text file (relative to your working folder or absolute): replace oldText exactly by newText. oldText must occur once, or set replaceAll: true to replace every occurrence. Read the file first.",
    inputSchema: EDIT_SCHEMA,
    execute: guarded(editFileTool),
  }),
  defineToolkitTool({
    id: "datei_loeschen",
    group: "files",
    isWrite: true,
    description:
      "Delete a file or folder (relative to your working folder or absolute); never the working folder itself. A consequential step: Pages first returns CONFIRMATION_REQUIRED; ask the person in the chat and repeat the identical call after they approved it.",
    inputSchema: DELETE_SCHEMA,
    isConsequential: () => true,
    execute: guarded(async (parameters, job) => {
      const root = await realRoot(job);
      const target = await resolveToolkitPath(
        job.root,
        parameters.path,
        job.protectedDirectories,
      );
      if (target === root) return toolkitRefusal("PROTECTED_PATH");
      await stat(target);
      await rm(target, { recursive: true });
      return toolkitResult({
        path: relativeToolkitPath(root, target),
        deleted: true,
      });
    }),
  }),
];
