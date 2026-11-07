import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import glueSource from "@/backend/agents/acp/PicaCodexGlueRuntime.mjs?raw";
import { patchPicaCodexAdapter } from "@/backend/agents/acp/PicaCodexAdapterPatch";

const DIRECTORY_FLAGS =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
type OwnedFiles = Map<
  string,
  { readonly device: number; readonly inode: number }
>;

const REQUIRED_DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "view_image",
  "js_repl",
  "code_mode",
  "apps",
  "plugins",
  "multi_agent",
] as const;

/** Refuses a Pica launch whose managed profile widens the known tool configuration. */
export function requirePicaCodexProfile(profile: unknown): void {
  if (typeof profile !== "object" || profile === null)
    throw new Error("Invalid Pica Codex profile");
  const config: unknown = Reflect.get(profile, "configuration");
  if (
    typeof config !== "object" ||
    config === null ||
    Reflect.get(config, "web_search") !== "disabled"
  )
    throw new Error("Invalid Pica Codex profile");
  const features: unknown = Reflect.get(config, "features");
  if (
    typeof features !== "object" ||
    features === null ||
    Array.isArray(features)
  )
    throw new Error("Invalid Pica Codex profile");
  if (
    Object.keys(features).length !== REQUIRED_DISABLED_FEATURES.length ||
    REQUIRED_DISABLED_FEATURES.some(
      (name) => Reflect.get(features, name) !== false,
    )
  )
    throw new Error("Invalid Pica Codex profile");
  // Built-in tool denial comes from the verified native build and its policy
  // acknowledgement at each thread start, not from this configuration alone.
}

/** A private generated adapter, retained until its owning process has ended. */
export interface PicaCodexBundle {
  readonly entry: string;
  readonly directory: string;
  readonly packageRoot: string;
  readonly runnerRoot: string;
  readonly cleanup: () => void;
}

function child(handle: number, name: string): string {
  return `/proc/self/fd/${handle}/${name}`;
}

function workspaceHandle(directory: string): number {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory)
    throw new Error("Invalid Pica workspace");
  let handle = openSync("/", DIRECTORY_FLAGS);
  try {
    for (const name of directory.split("/").filter(Boolean)) {
      const next = openSync(child(handle, name), DIRECTORY_FLAGS);
      closeSync(handle);
      handle = next;
    }
    const facts = fstatSync(handle);
    if (
      realpathSync(`/proc/self/fd/${handle}`) !== directory ||
      facts.uid !== process.getuid?.() ||
      (facts.mode & 0o777) !== 0o700
    )
      throw new Error("Invalid Pica workspace");
    return handle;
  } catch (error: unknown) {
    closeSync(handle);
    throw error;
  }
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readBounded(file: string, maximum: number): string {
  const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const facts = fstatSync(handle);
    if (!facts.isFile() || facts.size < 1 || facts.size > maximum)
      throw new Error("Invalid adapter file");
    const bytes = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(handle, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > maximum) throw new Error("Invalid adapter file");
    return bytes.subarray(0, size).toString("utf8");
  } finally {
    closeSync(handle);
  }
}

function writeOwned(
  handle: number,
  files: OwnedFiles,
  name: string,
  text: string,
): void {
  const file = openSync(
    child(handle, name),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o400,
  );
  try {
    const facts = fstatSync(file);
    files.set(name, { device: facts.dev, inode: facts.ino });
    writeFileSync(file, text, "utf8");
  } finally {
    closeSync(file);
  }
}

function removeOwned(handle: number, files: OwnedFiles): void {
  for (const [name, expected] of files) {
    const facts = lstatSync(child(handle, name));
    if (
      !facts.isFile() ||
      facts.dev !== expected.device ||
      facts.ino !== expected.inode ||
      facts.uid !== process.getuid?.() ||
      facts.nlink !== 1
    )
      throw new Error("Pica adapter artifact changed");
  }
  fchmodSync(handle, 0o700);
  for (const name of files.keys()) unlinkSync(child(handle, name));
}

function requireAdapter(file: string): {
  readonly bundle: string;
  readonly metadata: string;
  readonly license: string;
  readonly packageRoot: string;
  readonly original: string;
  readonly notice: string | null;
} {
  const original = realpathSync(file);
  if (
    path.basename(original) !== "index.js" ||
    path.basename(path.dirname(original)) !== "dist"
  )
    throw new Error("Unsupported Codex adapter");
  const packageRoot = path.dirname(path.dirname(original));
  const metadata = readBounded(
    path.join(packageRoot, "package.json"),
    256 * 1024,
  );
  const bundle = readBounded(original, 16 * 1024 * 1024);
  const license = readBounded(path.join(packageRoot, "LICENSE"), 128 * 1024);
  if (!license.includes("Apache License") || !license.includes("JetBrains"))
    throw new Error("Unsupported Codex adapter license");
  let notice: string | null = null;
  try {
    notice = readBounded(path.join(packageRoot, "NOTICE"), 128 * 1024);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  return { original, packageRoot, metadata, bundle, license, notice };
}

/** Builds one pinned, read-only adapter and its embedded Pages glue in a private workspace. */
export function preparePicaCodexBundle(
  workspace: string,
  adapter: string,
  runnerRoot: string,
): PicaCodexBundle {
  const original = requireAdapter(adapter);
  const root = workspaceHandle(workspace);
  const name = `.pica-codex-${randomUUID()}`;
  const files: OwnedFiles = new Map();
  let directory = -1;
  try {
    mkdirSync(child(root, name), { mode: 0o700 });
    directory = openSync(child(root, name), DIRECTORY_FLAGS);
    const directoryPath = path.join(workspace, name);
    const gluePath = path.join(directoryPath, "glue.mjs");
    const glueHash = digest(glueSource);
    const patched = patchPicaCodexAdapter(original.bundle, original.metadata, {
      path: gluePath,
      sha256: glueHash,
      upstreamBundlePath: original.original,
    });
    writeOwned(directory, files, "glue.mjs", glueSource);
    writeOwned(directory, files, "adapter.mjs", patched);
    writeOwned(directory, files, "LICENSE", original.license);
    if (original.notice)
      writeOwned(directory, files, "NOTICE", original.notice);
    writeOwned(
      directory,
      files,
      "provenance.json",
      JSON.stringify({
        adapter: "@agentclientprotocol/codex-acp",
        version: "2.2.2",
        original: digest(original.bundle),
        glue: glueHash,
        patched: digest(patched),
      }),
    );
    fchmodSync(directory, 0o500);
    return ownedBundle({
      root,
      directory,
      name,
      workspace,
      packageRoot: original.packageRoot,
      runnerRoot,
      files,
    });
  } catch (error: unknown) {
    if (directory >= 0) {
      removeOwned(directory, files);
      closeSync(directory);
    }
    closeSync(root);
    throw error;
  }
}

function ownedBundle(options: {
  readonly root: number;
  readonly directory: number;
  readonly name: string;
  readonly workspace: string;
  readonly packageRoot: string;
  readonly runnerRoot: string;
  readonly files: OwnedFiles;
}): PicaCodexBundle {
  const facts = fstatSync(options.directory);
  const directoryPath = path.join(options.workspace, options.name);
  let closed = false;
  return {
    directory: directoryPath,
    entry: path.join(directoryPath, "adapter.mjs"),
    packageRoot: options.packageRoot,
    runnerRoot: options.runnerRoot,
    cleanup: () => {
      if (closed) return;
      const current = lstatSync(child(options.root, options.name));
      if (
        !current.isDirectory() ||
        current.dev !== facts.dev ||
        current.ino !== facts.ino ||
        current.uid !== process.getuid?.()
      )
        throw new Error("Pica adapter directory changed");
      removeOwned(options.directory, options.files);
      closeSync(options.directory);
      closeSync(options.root);
      closed = true;
    },
  };
}
