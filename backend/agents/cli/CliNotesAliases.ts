import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { containsWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { isMissingPath } from "@/backend/service/agents/AgentCanonicalPath";

interface MountLocation {
  readonly device: string;
  readonly root: string;
  readonly directory: string;
}

function mountLocation(line: string): MountLocation {
  const fields = line.split(" ");
  if (fields.length < 10 || !fields.includes("-"))
    throw new AgentError("plan_notes_path_invalid");
  const decode = (field: string): string =>
    field.replace(/\\([0-7]{3})/gu, (match: string) =>
      String.fromCharCode(Number.parseInt(match.slice(1), 8)),
    );
  return {
    device: fields[2],
    root: decode(fields[3]),
    directory: decode(fields[4]),
  };
}

/** Finds bind-mount aliases too: realpath alone only resolves symbolic links. */
export function notesAliasPaths(
  directory: string,
  mountInfo: string,
): readonly string[] {
  const mounts = mountInfo
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(mountLocation);
  const source = mounts
    .filter((mount) => containsWorkspacePath(mount.directory, directory))
    .sort(
      (first, second) => second.directory.length - first.directory.length,
    )[0];
  if (!source) throw new AgentError("plan_notes_path_invalid");
  const location = path.join(
    source.root,
    path.relative(source.directory, directory),
  );
  const aliases = mounts
    .filter((mount) => mount.device === source.device)
    .flatMap((mount) => {
      if (containsWorkspacePath(mount.root, location))
        return [
          path.join(mount.directory, path.relative(mount.root, location)),
        ];
      return containsWorkspacePath(location, mount.root)
        ? [mount.directory]
        : [];
    });
  return [...new Set([directory, ...aliases])];
}

/** Fails closed on an unreadable mount table; an absent notes area has nothing to expose. */
export async function hiddenNotesDirectories(
  root?: string,
): Promise<readonly string[]> {
  if (!root) return [];
  let directory: string;
  try {
    directory = await realpath(root);
  } catch (error: unknown) {
    if (isMissingPath(error)) return [];
    throw error;
  }
  return notesAliasPaths(
    directory,
    await readFile("/proc/self/mountinfo", "utf8"),
  );
}
