import { lstat } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import type { CliHome } from "./CliContracts";

/** Operator-selected, dedicated context for exactly one persisted connection. */
export interface AntigravityContextBinding {
  readonly connectionId: string;
  readonly root: string;
}

/** Reads the optional operator-only binding; incomplete configuration fails closed. */
export function antigravityContextBinding(
  environment: NodeJS.ProcessEnv,
): AntigravityContextBinding | null {
  const connectionId = environment.PAGES_ANTIGRAVITY_CONNECTION_ID;
  const root = environment.PAGES_ANTIGRAVITY_CONTEXT_ROOT;
  if (connectionId === undefined && root === undefined) return null;
  if (
    !connectionId ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
      connectionId,
    ) ||
    !root ||
    !path.isAbsolute(root) ||
    root.endsWith(path.sep) ||
    path.normalize(root) !== root ||
    root === "/"
  )
    throw new AgentError("antigravity_configuration_unmanaged");
  return { connectionId, root };
}

/** Maps the explicitly bound context without copying its credentials. */
export function boundAntigravityHome(
  binding: AntigravityContextBinding,
): CliHome {
  return {
    root: binding.root,
    home: path.join(binding.root, "home"),
    config: path.join(binding.root, "gemini"),
    work: path.join(binding.root, "work"),
    xdgConfig: path.join(binding.root, "config"),
    xdgCache: path.join(binding.root, "work"),
  };
}

/** Verifies ownership, permissions and every ancestor without reading credentials. */
export async function requireBoundAntigravityHome(
  home: CliHome,
): Promise<void> {
  const user = process.getuid?.();
  if (user === undefined)
    throw new AgentError("antigravity_configuration_unmanaged");
  const segments = home.root.split(path.sep).filter(Boolean);
  let directory: string = path.sep;
  for (const segment of segments) {
    directory = path.join(directory, segment);
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.uid !== user && metadata.uid !== 0) ||
      (metadata.mode & 0o022) !== 0
    )
      throw new AgentError("antigravity_configuration_unmanaged");
  }
  for (const child of [
    home.root,
    home.home,
    home.config,
    home.work,
    home.xdgConfig,
  ]) {
    if (!child) throw new AgentError("antigravity_configuration_unmanaged");
    const metadata = await lstat(child);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== user ||
      (metadata.mode & 0o077) !== 0
    )
      throw new AgentError("antigravity_configuration_unmanaged");
  }
}
