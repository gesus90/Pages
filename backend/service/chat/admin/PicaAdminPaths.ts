import { constants, realpathSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { PicaAdminError } from "./PicaAdminContracts";

import type { FileHandle } from "node:fs/promises";

/** Only this per-person handover directory is eligible; Pages data and workspaces are never roots. */
export const PICA_ADMIN_FILE_ROOT = path.join(homedir(), "pica-admin-files");
const SAFE_EXTENSION = /\.(?:txt|md|csv|json|html)$/iu;
const PROTECTED_NAME =
  /(?:secret|credential|password|passwd|token|config|private|id_rsa|id_ed25519|\.pem|\.key)/iu;

/** Rejects traversal, hidden/configuration names and unsupported file types before touching disk. */
export function adminPathParts(
  relative: string,
  isDirectory = false,
): string[] {
  if (isDirectory && relative === "") return [];
  const parts = relative.split("/");
  if (
    relative.length > 240 ||
    parts.some(
      (part) =>
        !/^[a-zA-Z0-9][a-zA-Z0-9_. -]*$/u.test(part) ||
        PROTECTED_NAME.test(part),
    ) ||
    (!isDirectory && !SAFE_EXTENSION.test(relative))
  )
    throw new PicaAdminError("PATH_DENIED");
  return parts;
}

async function openDirectory(
  parent: FileHandle,
  name: string,
): Promise<FileHandle> {
  return open(
    `/proc/self/fd/${parent.fd}/${name}`,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
}

async function requirePrivateDirectory(directory: FileHandle): Promise<void> {
  const facts = await directory.stat();
  if (facts.uid !== process.getuid?.() || (facts.mode & 0o022) !== 0)
    throw new PicaAdminError("PATH_DENIED");
}

/** Opens each component with O_NOFOLLOW, anchored to live descriptors even during path replacement. */
export async function openAdminDirectory(
  userId: string,
  parts: readonly string[],
): Promise<FileHandle> {
  if (!/^[a-zA-Z0-9-]+$/u.test(userId)) throw new PicaAdminError("PATH_DENIED");
  let directory = await open("/", constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const segments = [
      ...PICA_ADMIN_FILE_ROOT.split("/").filter(Boolean),
      userId,
      ...parts,
    ];
    for (const [index, segment] of segments.entries()) {
      const next = await openDirectory(directory, segment);
      await directory.close();
      directory = next;
      if (index >= segments.indexOf("pica-admin-files"))
        await requirePrivateDirectory(directory);
    }
    return directory;
  } catch (error: unknown) {
    await directory.close();
    throw error;
  }
}

/** Revalidates the live descriptor against the exact allowed path immediately before synchronous I/O. */
export function requireAdminFileLocation(
  file: FileHandle,
  userId: string,
  relative: string,
): void {
  const expected = path.join(PICA_ADMIN_FILE_ROOT, userId, relative);
  if (realpathSync(`/proc/self/fd/${file.fd}`) !== expected)
    throw new PicaAdminError("FILE_CONFLICT");
}

/** Keeps a file descriptor and its parent open until the caller finishes; no symlink is followed. */
export async function withAdminFile<Result>(input: {
  readonly userId: string;
  readonly relative: string;
  readonly isWritable?: boolean;
  readonly work: (file: FileHandle) => Promise<Result>;
}): Promise<Result> {
  const parts = adminPathParts(input.relative);
  const name = parts.pop();
  if (!name) throw new PicaAdminError("PATH_DENIED");
  const parent = await openAdminDirectory(input.userId, parts);
  try {
    const file = await open(
      `/proc/self/fd/${parent.fd}/${name}`,
      (input.isWritable ? constants.O_RDWR : constants.O_RDONLY) |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
    );
    try {
      const facts = await file.stat();
      const location = await realpath(`/proc/self/fd/${file.fd}`);
      const root = path.join(PICA_ADMIN_FILE_ROOT, input.userId) + path.sep;
      if (
        !facts.isFile() ||
        facts.nlink !== 1 ||
        (facts.mode & 0o022) !== 0 ||
        facts.uid !== process.getuid?.() ||
        !location.startsWith(root)
      )
        throw new PicaAdminError("PATH_DENIED");
      return await input.work(file);
    } finally {
      await file.close();
    }
  } finally {
    await parent.close();
  }
}
