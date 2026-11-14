import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import type { CliHome } from "./CliContracts";

/** Legacy run-owned transcripts, swept after their run settles. */
export const PLAN_SESSIONS_DIRECTORY = "plan-sessions";
/** Stable homes keyed by plan and session scope. */
export const PLAN_HOMES_DIRECTORY = "plan-homes";

/** A plan-owned Claude home and the single credential file mounted into it. */
export interface ClaudePlanSessionHome {
  readonly home: CliHome;
  readonly credential: { readonly source: string; readonly target: string };
}

/** Which plan session a transcript home belongs to. */
export interface ClaudePlanSessionScope {
  readonly planId: string;
  readonly runId: string;
  /** The node, or the group or loop whose members share one native session. */
  readonly scopeId: string;
  /** The failed run a native recovery resumes; legacy transcripts of this scope are adopted into the stable plan home. */
  readonly sourceRunId?: string;
}

const CREDENTIAL_FILE = ".credentials.json";
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

async function existingEntry(target: string): Promise<boolean> {
  return (await lstat(target).catch(() => null)) !== null;
}

async function requirePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new AgentError("cli_isolation_unavailable");
}

/** Adopts a legacy run home once, including the source of a native recovery. */
async function adoptSourceScope(
  connection: CliHome,
  scope: ClaudePlanSessionScope,
  destination: string,
): Promise<void> {
  if (await existingEntry(destination)) return;
  const hash = path.basename(destination);
  for (const runId of [scope.sourceRunId, scope.runId]) {
    if (!runId || !UUID.test(runId)) continue;
    const source = path.join(
      connection.root,
      PLAN_SESSIONS_DIRECTORY,
      runId,
      hash,
    );
    const metadata = await lstat(source).catch(() => null);
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) continue;
    await rename(source, destination);
    for (const relative of [
      "home/cache",
      "home/.cache",
      "home/data/pnpm",
      "home/.npm",
      "home/.local/share/pnpm",
    ])
      await rm(path.join(destination, relative), {
        recursive: true,
        force: true,
      });
    return;
  }
}

/**
 * Reuses one private transcript home per plan and scope across runs and native recovery.
 * Only the connection's credential file is exposed inside it. Completed transcripts
 * are swept independently; the stable home remains until the plan is deleted.
 */
export async function prepareClaudePlanSessionHome(
  connection: CliHome,
  scope: ClaudePlanSessionScope,
): Promise<ClaudePlanSessionHome> {
  const { planId, runId, scopeId } = scope;
  if (
    !UUID.test(planId) ||
    !UUID.test(runId) ||
    !scopeId ||
    scopeId.length > 200
  )
    throw new AgentError("plan_context_changed");
  const hash = createHash("sha256").update(scopeId).digest("hex");
  const sessions = path.join(connection.root, PLAN_HOMES_DIRECTORY);
  const root = path.join(sessions, planId, hash);
  const home: CliHome = {
    root,
    home: path.join(root, "home"),
    config: path.join(root, "claude"),
    work: path.join(root, "work"),
    sharedEnvironment: connection.sharedEnvironment,
  };
  const source = path.join(connection.config, CREDENTIAL_FILE);
  const target = path.join(home.config, CREDENTIAL_FILE);
  const credential = await lstat(source).catch(() => null);
  if (!credential?.isFile()) throw new AgentError("cli_not_logged_in");
  await access(source, constants.R_OK);
  await requirePrivateDirectory(sessions);
  await requirePrivateDirectory(path.join(sessions, planId));
  await adoptSourceScope(connection, scope, root);
  for (const directory of [
    path.join(sessions, planId),
    root,
    home.home,
    home.config,
    home.work,
  ])
    await requirePrivateDirectory(directory);
  const existing = await lstat(target).catch(() => null);
  if (existing === null) {
    const placeholder = await open(target, "wx", 0o600);
    await placeholder.close();
  } else if (!existing.isFile() || existing.isSymbolicLink()) {
    throw new AgentError("cli_isolation_unavailable");
  }
  return { home, credential: { source, target } };
}
