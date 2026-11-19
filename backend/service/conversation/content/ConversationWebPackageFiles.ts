import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  CONVERSATION_WEB_PACKAGE_MANIFEST_MAXIMUM_BYTES,
  CONVERSATION_WEB_PACKAGE_MAXIMUM_BYTES,
  conversationWebPackageManifestSchema,
} from "@/definition/ConversationInteractiveContent";

import type { ConversationWebPackageManifest } from "@/definition/ConversationInteractiveContent";

/** The first bytes of the files of a package, by their ending. */
const MAGIC_BYTES: Readonly<Record<string, Buffer | null>> = {
  ".wasm": Buffer.from([0x00, 0x61, 0x73, 0x6d]),
  ".pck": Buffer.from("GDPC", "latin1"),
  ".png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ".js": null,
};

/** The type each file of a package is served with. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".wasm": "application/wasm",
  ".pck": "application/octet-stream",
  ".png": "image/png",
  ".js": "text/javascript",
};

/** Why a web export package is not attached. */
export type WebPackageRefusal =
  "format" | "tooLarge" | "files" | "checksum" | "storeFailed";

/** One file of a package, checked on the disk where it was exported. */
export interface InspectedWebPackageFile {
  /** The name inside the package. */
  readonly path: string;
  /** The resolved path the bytes are read from; never leaves the server. */
  readonly sourcePath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** A web export package whose manifest and files were checked. */
export interface InspectedWebPackage {
  readonly manifest: ConversationWebPackageManifest;
  /** The manifest as Pages stores it: only the keys of its schema. */
  readonly manifestBytes: Buffer;
  readonly files: readonly InspectedWebPackageFile[];
  /** The name of the export directory, for the name of the attachment. */
  readonly directoryName: string;
}

/** An error of a package that failed while its files were stored. */
export class WebPackageError extends Error {
  public readonly refusal: WebPackageRefusal;

  public constructor(refusal: WebPackageRefusal) {
    super(`Web export package refused: ${refusal}`);
    this.refusal = refusal;
  }
}

/** The names the files of a package may have, for its executable and start image. */
function allowedNames(manifest: ConversationWebPackageManifest): Set<string> {
  const { executable } = manifest;
  return new Set([
    `${executable}.js`,
    `${executable}.wasm`,
    `${executable}.pck`,
    `${executable}.audio.worklet.js`,
    `${executable}.audio.position.worklet.js`,
    ...(manifest.poster === undefined ? [] : [manifest.poster]),
  ]);
}

/**
 * Checks the rules a schema cannot express: unique names, the three required
 * files, only known names, a PNG start image that is part of the package,
 * and the size of the whole package.
 */
function checkManifestRules(
  manifest: ConversationWebPackageManifest,
): WebPackageRefusal | null {
  const names = manifest.files.map((file) => file.path);
  if (new Set(names).size !== names.length) return "format";
  const allowed = allowedNames(manifest);
  if (names.some((name) => !allowed.has(name))) return "format";
  const { executable, poster } = manifest;
  for (const ending of [".js", ".wasm", ".pck"])
    if (!names.includes(`${executable}${ending}`)) return "files";
  if (
    poster !== undefined &&
    (!poster.endsWith(".png") || !names.includes(poster))
  )
    return "format";
  const total = manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  return total > CONVERSATION_WEB_PACKAGE_MAXIMUM_BYTES ? "tooLarge" : null;
}

async function readManifest(
  manifestPath: string,
): Promise<ConversationWebPackageManifest | WebPackageRefusal> {
  const facts = await lstat(manifestPath);
  if (!facts.isFile()) return "files";
  if (facts.size > CONVERSATION_WEB_PACKAGE_MANIFEST_MAXIMUM_BYTES)
    return "tooLarge";
  let input: unknown;
  try {
    input = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return "format";
  }
  const parsed = conversationWebPackageManifestSchema.safeParse(input);
  if (!parsed.success) return "format";
  return checkManifestRules(parsed.data) ?? parsed.data;
}

async function startsWith(filePath: string, magic: Buffer): Promise<boolean> {
  const handle = await open(filePath, "r");
  try {
    const head = Buffer.alloc(magic.length);
    const { bytesRead } = await handle.read(head, 0, magic.length, 0);
    return bytesRead === magic.length && head.equals(magic);
  } finally {
    await handle.close();
  }
}

/**
 * The SHA-256 of a file in lower-case hex.
 * @param filePath - The file.
 */
export async function fileChecksum(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Checks one listed file: a regular file in the export directory with its size, type and checksum. */
async function inspectFile(
  directory: string,
  entry: ConversationWebPackageManifest["files"][number],
): Promise<InspectedWebPackageFile | WebPackageRefusal> {
  const named = path.join(directory, entry.path);
  let resolved: string;
  try {
    resolved = await realpath(named);
  } catch {
    return "files";
  }
  if (path.dirname(resolved) !== directory) return "files";
  const facts = await lstat(resolved);
  if (!facts.isFile() || facts.size !== entry.sizeBytes) return "files";
  const ending = path.extname(entry.path).toLowerCase();
  const magic = MAGIC_BYTES[ending];
  if (magic === undefined) return "format";
  if (magic !== null && !(await startsWith(resolved, magic))) return "format";
  if ((await fileChecksum(resolved)) !== entry.sha256) return "checksum";
  return {
    path: entry.path,
    sourcePath: resolved,
    mimeType: MIME_TYPES[ending] ?? "application/octet-stream",
    sizeBytes: entry.sizeBytes,
    sha256: entry.sha256,
  };
}

/**
 * Checks a web export package by its manifest `pages-web-export.json`.
 * @param manifestPath - The resolved path of the manifest; its files lie
 * next to it.
 * @returns The checked package, or why it is not attached.
 * @remarks
 * Every listed file must lie directly in the directory of the manifest (a
 * symbolic link out of it is refused), have exactly the listed size, start
 * with the bytes of its kind (WebAssembly, Godot pack, PNG) and match its
 * SHA-256. Files the manifest does not list are never read. The checksums
 * are checked again while the files are copied, so a file that changes in
 * between is refused there.
 */
export async function inspectWebPackage(
  manifestPath: string,
): Promise<InspectedWebPackage | WebPackageRefusal> {
  const directory = await realpath(path.dirname(manifestPath));
  const manifest = await readManifest(manifestPath);
  if (typeof manifest === "string") return manifest;
  const files: InspectedWebPackageFile[] = [];
  for (const entry of manifest.files) {
    const file = await inspectFile(directory, entry);
    if (typeof file === "string") return file;
    files.push(file);
  }
  return {
    manifest,
    manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    files,
    directoryName: path.basename(directory),
  };
}
