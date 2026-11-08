import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, rename } from "node:fs/promises";
import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";

import type { CliHome } from "./CliContracts";

/**
 * Folder of a connection that holds the transcript homes of its plan runs.
 *
 * @remarks
 * A run's folder stays until its plan starts a new run; the deletion follows
 * the removal of the run record (`agent_payload_garbage`).
 */
export const PLAN_SESSIONS_DIRECTORY = "plan-sessions";

/** A plan-owned Claude home and the single credential file mounted into it. */
export interface ClaudePlanSessionHome {
  readonly home: CliHome;
  readonly credential: { readonly source: string; readonly target: string };
}

/** Which plan session a transcript home belongs to. */
export interface ClaudePlanSessionScope {
  readonly runId: string;
  /** The node, or the group or loop whose members share one native session. */
  readonly scopeId: string;
  /** The failed run a native recovery resumes; its transcripts of this scope move to `runId`. */
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

/**
 * Moves the transcripts of one scope from the failed run a recovery resumes.
 *
 * @remarks
 * A recovery is a new linked run with its own ID, but its native resume needs
 * the earlier session files. The source run is already continued and offers
 * no second recovery, so a move leaves exactly one owner of the history. A
 * scope the new run already holds is never replaced.
 */
async function adoptSourceScope(
  sessions: string,
  scope: ClaudePlanSessionScope,
  hash: string,
): Promise<void> {
  const { sourceRunId, runId } = scope;
  if (!sourceRunId || sourceRunId === runId || !UUID.test(sourceRunId)) return;
  const from = path.join(sessions, sourceRunId, hash);
  const to = path.join(sessions, runId, hash);
  const source = await lstat(from).catch(() => null);
  if (!source?.isDirectory() || source.isSymbolicLink()) return;
  if (await existingEntry(to)) return;
  await requirePrivateDirectory(path.join(sessions, runId));
  await rename(from, to);
}

/**
 * Creates a private transcript home stable across attempts of one plan session.
 *
 * @param connection - The connection's own home, which holds its login.
 * @param scope - The run and the node or group the session belongs to.
 *
 * @remarks
 * The source credential is never copied. Bubblewrap exposes only this home
 * and binds the one credential file into it, writable so a refreshed token
 * reaches the connection; other connection settings, the history of other
 * runs and the chats of Pica stay hidden. The transcripts stay until the
 * plan starts a new run, so a stopped, failed or paused run can still be
 * resumed. A missing or linked credential fails closed.
 */
export async function prepareClaudePlanSessionHome(
  connection: CliHome,
  scope: ClaudePlanSessionScope,
): Promise<ClaudePlanSessionHome> {
  const { runId, scopeId } = scope;
  if (!UUID.test(runId) || !scopeId || scopeId.length > 200)
    throw new AgentError("plan_context_changed");
  const hash = createHash("sha256").update(scopeId).digest("hex");
  const sessions = path.join(connection.root, PLAN_SESSIONS_DIRECTORY);
  const root = path.join(sessions, runId, hash);
  const home: CliHome = {
    root,
    home: path.join(root, "home"),
    config: path.join(root, "claude"),
    work: path.join(root, "work"),
  };
  const source = path.join(connection.config, CREDENTIAL_FILE);
  const target = path.join(home.config, CREDENTIAL_FILE);
  const credential = await lstat(source).catch(() => null);
  if (!credential?.isFile()) throw new AgentError("cli_not_logged_in");
  await access(source, constants.R_OK);
  await requirePrivateDirectory(sessions);
  await adoptSourceScope(sessions, scope, hash);
  for (const directory of [
    path.join(sessions, runId),
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
