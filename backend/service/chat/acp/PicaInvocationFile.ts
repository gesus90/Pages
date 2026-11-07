import { randomUUID } from "node:crypto";
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
  writeSync,
} from "node:fs";
import path from "node:path";

import type { PicaBridgeDescriptor } from "./PicaBridge";

const MAXIMUM_DESCRIPTOR_BYTES = 4096;
const DIRECTORY_FLAGS =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const DESCRIPTOR_NAME = "invocation.json";
const HELPER_NAME = "pages-pica";
const DIRECTORY_NAME = /^\.pica-[0-9a-f-]{36}$/u;

function child(parent: number, name: string): string {
  return `/proc/self/fd/${parent}/${name}`;
}

function requirePrivate(handle: number): void {
  const facts = fstatSync(handle);
  const owner = process.getuid?.();
  if (
    !facts.isDirectory() ||
    (facts.mode & 0o777) !== 0o700 ||
    owner === undefined ||
    facts.uid !== owner
  )
    throw new Error("Invalid Pica invocation directory");
}

function openDirectory(directory: string): number {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory)
    throw new Error("Invalid Pica invocation directory");
  let handle = openSync("/", DIRECTORY_FLAGS);
  try {
    for (const name of directory.split("/").filter(Boolean)) {
      const next = openSync(child(handle, name), DIRECTORY_FLAGS);
      closeSync(handle);
      handle = next;
    }
    if (realpathSync(`/proc/self/fd/${handle}`) !== directory)
      throw new Error("Pica invocation directory changed");
    requirePrivate(handle);
    return handle;
  } catch (error: unknown) {
    closeSync(handle);
    throw error;
  }
}

function descriptorPaths(file: string): { workspace: string; name: string } {
  const directory = path.dirname(file);
  const name = path.basename(directory);
  const workspace = path.dirname(directory);
  if (
    path.basename(file) !== DESCRIPTOR_NAME ||
    !DIRECTORY_NAME.test(name) ||
    path.join(directory, DESCRIPTOR_NAME) !== file
  )
    throw new Error("Invalid Pica invocation file");
  return { workspace, name };
}

function requireFile(handle: number): void {
  const facts = fstatSync(handle);
  const owner = process.getuid?.();
  if (
    !facts.isFile() ||
    facts.nlink !== 1 ||
    (facts.mode & 0o777) !== 0o600 ||
    owner === undefined ||
    facts.uid !== owner ||
    facts.size > MAXIMUM_DESCRIPTOR_BYTES
  )
    throw new Error("Invalid Pica invocation file");
}

function openPrivateChild(workspace: number, name: string): number {
  const handle = openSync(child(workspace, name), DIRECTORY_FLAGS);
  try {
    requirePrivate(handle);
    return handle;
  } catch (error: unknown) {
    closeSync(handle);
    throw error;
  }
}

/** Runs `use` with an open handle and closes it afterwards. */
function withHandle<T>(handle: number, use: (handle: number) => T): T {
  try {
    return use(handle);
  } finally {
    closeSync(handle);
  }
}

function writeAll(handle: number, contents: Buffer): void {
  let offset = 0;
  while (offset < contents.length) {
    const written = writeSync(
      handle,
      contents,
      offset,
      contents.length - offset,
    );
    if (written === 0) throw new Error("Pica invocation write failed");
    offset += written;
  }
}

/** Writes the descriptor exclusively and confirms it landed at `expected`. */
function writeDescriptor(
  directory: number,
  contents: Buffer,
  expected: string,
): void {
  const handle = openSync(
    child(directory, DESCRIPTOR_NAME),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  withHandle(handle, () => {
    requireFile(handle);
    writeAll(handle, contents);
    if (realpathSync(`/proc/self/fd/${handle}`) !== expected)
      throw new Error("Pica invocation file changed");
  });
}

function writePrivateFile(
  directory: number,
  name: string,
  contents: Buffer,
  mode: number,
): void {
  const handle = openSync(
    child(directory, name),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    mode,
  );
  withHandle(handle, () => {
    writeAll(handle, contents);
    fchmodSync(handle, mode);
  });
}

/** Removes one entry of the private directory; a missing entry is already removed. */
function unlinkEntry(directory: number, name: string): void {
  try {
    unlinkSync(child(directory, name));
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}

/** Reads at most the descriptor limit; a longer file is refused. */
function readBounded(handle: number): Buffer {
  const buffer = Buffer.alloc(MAXIMUM_DESCRIPTOR_BYTES + 1);
  let size = 0;
  for (;;) {
    const count = readSync(handle, buffer, size, buffer.length - size, null);
    if (count === 0) return buffer.subarray(0, size);
    size += count;
    if (size > MAXIMUM_DESCRIPTOR_BYTES)
      throw new Error("Invalid Pica invocation file");
  }
}

/** Refuses a file that was replaced or changed while it was read. */
function requireUnchanged(
  before: ReturnType<typeof fstatSync>,
  after: ReturnType<typeof fstatSync>,
  size: number,
): void {
  if (
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.size !== after.size ||
    size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  )
    throw new Error("Pica invocation file changed");
}

function parseDescriptor(
  contents: Buffer,
  expectedUrl: string,
): PicaBridgeDescriptor {
  const parsed: unknown = JSON.parse(contents.toString("utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("url" in parsed) ||
    !("authorization" in parsed) ||
    parsed.url !== expectedUrl ||
    typeof parsed.authorization !== "string" ||
    !/^Bearer [A-Za-z0-9_-]{43}$/u.test(parsed.authorization)
  )
    throw new Error("Invalid Pica invocation descriptor");
  return { url: expectedUrl, authorization: parsed.authorization };
}

/**
 * Creates a private invocation file anchored to a verified workspace.
 *
 * @param workspace - The verified workspace of the chat.
 * @param descriptor - The turn credential and the route that accepts it.
 * @param helperScript - The executable helper text a Claude Code turn runs next to the file.
 * @returns The path of the descriptor file.
 */
export function writePicaInvocationFile(
  workspace: string,
  descriptor: PicaBridgeDescriptor,
  helperScript?: string,
): string {
  const contents = Buffer.from(JSON.stringify(descriptor), "utf8");
  if (contents.length > MAXIMUM_DESCRIPTOR_BYTES)
    throw new Error("Invalid Pica invocation descriptor");
  const parent = openDirectory(workspace);
  const name = `.pica-${randomUUID()}`;
  const file = path.join(workspace, name, DESCRIPTOR_NAME);
  try {
    mkdirSync(child(parent, name), { mode: 0o700 });
    withHandle(openPrivateChild(parent, name), (directory) => {
      writeDescriptor(directory, contents, file);
      if (helperScript !== undefined)
        writePrivateFile(
          directory,
          HELPER_NAME,
          Buffer.from(helperScript, "utf8"),
          0o500,
        );
    });
    return file;
  } catch (error: unknown) {
    try {
      removePicaInvocationFile(workspace, file);
    } catch {
      // An incomplete private directory remains for operator cleanup.
    }
    throw error;
  } finally {
    closeSync(parent);
  }
}

/**
 * Returns the helper path that belongs to a descriptor file.
 *
 * @param file - The descriptor file written by {@link writePicaInvocationFile}.
 * @returns The absolute path of the helper in the same private directory.
 */
export function picaHelperPath(file: string): string {
  descriptorPaths(file);
  return path.join(path.dirname(file), HELPER_NAME);
}

/** Removes the credential and the helper; workspace deletion later reclaims the empty directory. */
export function removePicaInvocationFile(
  expectedWorkspace: string,
  file: string,
): void {
  const { workspace, name } = descriptorPaths(file);
  if (workspace !== expectedWorkspace)
    throw new Error("Invalid Pica invocation workspace");
  withHandle(openDirectory(workspace), (parent) =>
    withHandle(openPrivateChild(parent, name), (directory) => {
      const entry = lstatSync(child(parent, name));
      const opened = fstatSync(directory);
      if (entry.dev !== opened.dev || entry.ino !== opened.ino)
        throw new Error("Pica invocation directory changed");
      for (const entryName of [DESCRIPTOR_NAME, HELPER_NAME])
        unlinkEntry(directory, entryName);
    }),
  );
}

/** Reads a bounded descriptor only for its independently expected destination. */
export function readPicaInvocationFile(
  file: string,
  expectedUrl: string,
): PicaBridgeDescriptor {
  const { workspace, name } = descriptorPaths(file);
  return withHandle(openDirectory(workspace), (parent) =>
    withHandle(openPrivateChild(parent, name), (directory) => {
      const handle = openSync(
        child(directory, DESCRIPTOR_NAME),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      return withHandle(handle, () => {
        requireFile(handle);
        const before = fstatSync(handle);
        const contents = readBounded(handle);
        requireFile(handle);
        const after = fstatSync(handle);
        if (realpathSync(`/proc/self/fd/${handle}`) !== file)
          throw new Error("Pica invocation file changed");
        requireUnchanged(before, after, contents.length);
        return parseDescriptor(contents, expectedUrl);
      });
    }),
  );
}
