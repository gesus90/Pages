import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { CliWorkerCommand } from "./CliWorkerUnit";

const JOURNALCTL = "/usr/bin/journalctl";
/** Reading the journal of every worker unit since the oldest lease may take a while. */
const COMMAND_TIMEOUT_MS = 30_000;
/** A few lines per worker unit; this bounds a corrupt or unexpectedly large answer. */
const MAX_JOURNAL_BYTES = 32 * 1024 * 1024;
const UNIT_PREFIX = "pages-acp-";
/** The session tag and the random suffix every worker unit name carries. */
const UNIT_NAME = /^pages-acp-([A-Za-z0-9-]+)-[a-f0-9]{8}\.service$/u;
/** A lease is recorded before its unit starts; this absorbs clock corrections. */
const SINCE_SLACK_SECONDS = 300;
/** systemd catalog: a start job for the unit began or finished. */
const STARTED_MESSAGES = new Set([
  "7d4958e842da4a758f6c1cdc7b36dcc5",
  "39f53479d3a045ac8e11786248231fbf",
]);
/** systemd catalog: the stop job finished, the unit succeeded or failed, or its start failed. */
const ENDED_MESSAGES = new Set([
  "9d1aaa27d60140bd96365438aad20286",
  "7ad2d189f7e94e70a38c781354912448",
  "d9b373ed55a64feb8242e02dbe79a49c",
  "be02cf6855d2428ba40df7e9d022f03d",
]);

const execFileAsync = promisify(execFile);

function runJournal(
  file: string,
  args: readonly string[],
): Promise<{ readonly stdout: string }> {
  return execFileAsync(file, [...args], {
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_JOURNAL_BYTES,
    env: { PATH: "/usr/bin:/bin" },
  });
}

interface JournalEvent {
  readonly unit: string;
  readonly message: string;
}

function readEvent(line: string): JournalEvent | null {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("Unreadable journal entry");
  const unit: unknown = Reflect.get(parsed, "USER_UNIT");
  const message: unknown = Reflect.get(parsed, "MESSAGE_ID");
  if (typeof unit !== "string" || typeof message !== "string") return null;
  return { unit, message };
}

interface UnitHistory {
  readonly units: Set<string>;
  hasStarted: boolean;
  lastEvent: "started" | "ended" | null;
}

function recordEvent(
  histories: Map<string, UnitHistory>,
  event: JournalEvent,
): void {
  const match = UNIT_NAME.exec(event.unit);
  const instanceId = match?.[1];
  if (!instanceId) return;
  const history = histories.get(instanceId) ?? {
    units: new Set<string>(),
    hasStarted: false,
    lastEvent: null,
  };
  histories.set(instanceId, history);
  history.units.add(event.unit);
  if (STARTED_MESSAGES.has(event.message)) {
    history.hasStarted = true;
    history.lastEvent = "started";
  } else if (ENDED_MESSAGES.has(event.message)) history.lastEvent = "ended";
}

/**
 * Reads which sessions the user journal proves ended: their only worker unit
 * started and then ended (PAGE-340).
 *
 * @param query - The earliest lease start to cover, as an ISO timestamp, and
 * optionally the one session tag to read.
 * @param command - Runs `journalctl`; defaults to a real process.
 * @returns For each journaled session tag, `true` only when exactly one unit
 * of it is journaled, its start was recorded and its last recorded manager
 * event is an end. A session that is missing, rotated away or only partly
 * journaled is absent or `false`: it proves nothing.
 * @throws When the journal answers with entries that cannot be read.
 *
 * @remarks
 * Every process of a session started in a limited unit runs inside that
 * unit, and one start creates exactly one unit. Together with a service
 * manager that lists no running unit of the session, a journaled end proves
 * that nothing of it remains, also for a lease without recorded process
 * identity. The journal is read once for all leases; nothing is stopped or
 * signalled.
 */
export async function readJournaledWorkerUnitEnds(
  query: { readonly since: string; readonly instanceId?: string },
  command: CliWorkerCommand = runJournal,
): Promise<ReadonlyMap<string, boolean>> {
  const began = Date.parse(query.since);
  if (!Number.isFinite(began)) throw new Error("Invalid journal start");
  const tag = query.instanceId ?? "";
  if (!/^[A-Za-z0-9-]*$/u.test(tag)) throw new Error("Invalid session tag");
  const listed = await command(JOURNALCTL, [
    "--user",
    "--no-pager",
    "--quiet",
    "--output=json",
    "--output-fields=MESSAGE_ID,USER_UNIT",
    `--since=@${Math.max(0, Math.floor(began / 1000) - SINCE_SLACK_SECONDS)}`,
    `--user-unit=${UNIT_PREFIX}${tag === "" ? "" : `${tag}-`}*`,
  ]);
  const histories = new Map<string, UnitHistory>();
  for (const line of listed.stdout.split("\n")) {
    if (!line.trim()) continue;
    const event = readEvent(line);
    if (event !== null) recordEvent(histories, event);
  }
  return new Map(
    [...histories].map(([instanceId, history]) => [
      instanceId,
      history.units.size === 1 &&
        history.hasStarted &&
        history.lastEvent === "ended",
    ]),
  );
}
