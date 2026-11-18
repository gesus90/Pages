import { readAgentObject } from "@/backend/agents/AgentPayload";
import { providerResetTimestamp } from "@/backend/agents/providers/ProviderReset";
import { AgentError } from "@/backend/error/AgentErrors";
import { ANTIGRAVITY_QUOTA_GROUP_LIMIT } from "@/definition/AntigravityQuota";

import type {
  AntigravityQuotaGroup,
  AntigravityQuotaWindow,
  AntigravityQuotaWindowKind,
} from "@/definition/AntigravityQuota";

/** The longest group or window name the reading keeps. */
const NAME_LIMIT = 200;

/** The name print mode reports for the answered `/usage` command. */
const USAGE_COMMAND = "usage";

const FIVE_HOUR_PATTERN =
  /\b(?:5\s?h(?:ours?|rs?)?|five\s?hours?|pt5h|18000s?)\b/u;

const SEVEN_DAY_PATTERN =
  /\b(?:7\s?d(?:ays?)?|seven\s?days?|week(?:ly|s)?|p7d|pt168h|168\s?h(?:ours?)?|604800s?)\b/u;

function unexpected(): AgentError {
  return new AgentError("cli_unexpected_output");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Reads the JSON object of an answer.
 * @remarks
 * The answer may wrap the object in a sentence or a code fence, so the text
 * between the first `{` and the last `}` counts as well.
 */
function parseObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  const candidates = [trimmed];
  if (first >= 0 && last > first)
    candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    const parsed = readAgentObject(parseJson(candidate));
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return null;
}

/**
 * The structured data of a print-mode command, when the envelope carries it.
 * @remarks
 * A slash command answered without a model turn names itself in `command`
 * and puts its structured output in `command.data`; `response` then holds
 * only the tab-separated text version. The data of another command is no
 * usage.
 */
function readCommandData(
  envelope: Record<string, unknown>,
): Record<string, unknown> | null {
  if (envelope.command === undefined) return null;
  const command = readAgentObject(envelope.command);
  if (command.name !== USAGE_COMMAND) return null;
  return readAgentObject(command.data);
}

/**
 * The payload of an answer.
 * @remarks
 * `agy --print --output-format json` wraps the answer of a command in an
 * envelope with a `status`; a command's structured data is read from
 * `command.data`, otherwise from a JSON `response`. A bare object is the
 * payload itself. An envelope that is not a success carries no usage.
 */
function readPayload(output: string): Record<string, unknown> | null {
  const outer = parseObject(output);
  if (outer === null) return null;
  const { status, response } = outer;
  if (typeof status !== "string") return outer;
  if (status.toUpperCase() !== "SUCCESS") return null;
  if (outer.command !== undefined) return readCommandData(outer);
  return typeof response === "string"
    ? parseObject(response)
    : readAgentObject(response);
}

/** The fixed outcome values of a print-mode envelope, safe for the server log. */
export interface AntigravityEnvelopeOutcome {
  /** The envelope status in capitals, such as `SUCCESS` or `ERROR`. */
  readonly status: string | null;
  /** The number of agent turns; a command answered without a model has 0. */
  readonly turns: number | null;
  /** The name of the slash command print mode answered itself. */
  readonly command: string | null;
}

/**
 * Reads the outcome of an `agy --print --output-format json` envelope for the
 * server log, without any reported text.
 * @param output - The standard output of the command.
 * @returns The envelope status, the number of model turns and the name of the
 * answered command, each `null` when the output does not carry it.
 * @remarks
 * The values are fixed words and counts of the CLI; account names, quota
 * descriptions and error texts stay out of the log.
 */
export function readAntigravityEnvelopeOutcome(
  output: string,
): AntigravityEnvelopeOutcome {
  const envelope = parseObject(output) ?? {};
  const command = readAgentObject(envelope.command).name;
  return {
    status:
      typeof envelope.status === "string" &&
      /^[A-Z_]{1,40}$/u.test(envelope.status)
        ? envelope.status
        : null,
    turns:
      typeof envelope.num_turns === "number" &&
      Number.isInteger(envelope.num_turns)
        ? envelope.num_turns
        : null,
    command:
      typeof command === "string" && /^[a-z_-]{1,40}$/u.test(command)
        ? command
        : null,
  };
}

/**
 * Tells which column a reported window belongs to.
 * @remarks
 * A window is the five-hour or the seven-day one; any other window is not
 * shown, because the card has no place for it.
 */
function readWindowKind(reported: unknown): AntigravityQuotaWindowKind | null {
  if (typeof reported !== "string" && typeof reported !== "number") return null;
  const text = String(reported).toLowerCase().replace(/[_-]+/gu, " ");
  if (FIVE_HOUR_PATTERN.test(text)) return "five_hour";
  if (SEVEN_DAY_PATTERN.test(text)) return "seven_day";
  return null;
}

function readName(entry: Record<string, unknown>): string | null {
  const name = entry.display_name ?? entry.displayName ?? entry.name;
  if (typeof name !== "string" || name.trim() === "") return null;
  return name.trim().slice(0, NAME_LIMIT);
}

/**
 * Reads one window of a group.
 * @remarks
 * The window needs a known `window`, and a finite `remaining_fraction` from 0
 * to 1 that the source reported; a disabled window or one without such a
 * rest is not reported. `reset_time` is a time with a zone, shown in the
 * viewer's local time.
 */
function readBucket(reported: unknown): AntigravityQuotaWindow | null {
  const bucket = readAgentObject(reported);
  if (bucket.disabled === true) return null;
  const kind = readWindowKind(bucket.window);
  const remaining = bucket.remaining_fraction ?? bucket.remainingFraction;
  if (kind === null) return null;
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) return null;
  if (remaining < 0 || remaining > 1) return null;
  return {
    kind,
    remainingFraction: remaining,
    resetsAt: providerResetTimestamp(bucket.reset_time ?? bucket.resetTime),
  };
}

/** The windows of a group; a kind reported twice keeps its first value. */
function readWindows(buckets: unknown): AntigravityQuotaWindow[] {
  if (!Array.isArray(buckets)) return [];
  const windows: AntigravityQuotaWindow[] = [];
  for (const bucket of buckets) {
    const window = readBucket(bucket);
    if (window && !windows.some((entry) => entry.kind === window.kind))
      windows.push(window);
  }
  return windows;
}

function readGroupList(reported: unknown): AntigravityQuotaGroup[] {
  if (!Array.isArray(reported)) return [];
  const groups: AntigravityQuotaGroup[] = [];
  for (const entry of reported) {
    const group = readAgentObject(entry);
    const name = readName(group);
    const windows = readWindows(group.buckets ?? group.windows);
    if (name !== null && windows.length > 0) groups.push({ name, windows });
  }
  return groups;
}

/**
 * Reads quotas that the source reports without a group, such as the quota of
 * a single model, as groups of their own.
 * @remarks
 * Windows with the same name belong to one group.
 */
function readUngroupedBuckets(reported: unknown): AntigravityQuotaGroup[] {
  if (!Array.isArray(reported)) return [];
  const windowsByName = new Map<string, AntigravityQuotaWindow[]>();
  for (const entry of reported) {
    const bucket = readAgentObject(entry);
    const name = readName(bucket) ?? readName({ name: bucket.bucket_id });
    const window = readBucket(entry);
    if (name === null || window === null) continue;
    const windows = windowsByName.get(name) ?? [];
    if (!windows.some((known) => known.kind === window.kind))
      windows.push(window);
    windowsByName.set(name, windows);
  }
  return [...windowsByName].map(([name, windows]) => ({ name, windows }));
}

/**
 * Reads the answer of the `/usage` command of Antigravity.
 * @param output - The envelope of `agy --print /usage --output-format json`,
 * or a bare JSON object with the groups.
 * @returns Every group Antigravity reported in the order of the source, each
 * with the windows it reported; empty when the answer holds no quota data.
 * @throws {AgentError} `cli_unexpected_output` when the answer is no usage
 * answer: not JSON, an envelope without success, the data of another
 * command, or without any group list.
 * @remarks
 * Each window carries `remaining_fraction`, `reset_time` and `window`. The
 * rest is kept as reported and never derived from a used share.
 */
export function readAntigravityUsage(
  output: string,
): readonly AntigravityQuotaGroup[] {
  const payload = readPayload(output);
  if (payload === null) throw unexpected();
  const reported =
    payload.groups ?? payload.quota_groups ?? payload.quotaGroups;
  if (!Array.isArray(reported) && !Array.isArray(payload.buckets))
    throw unexpected();
  return [
    ...readGroupList(reported),
    ...readUngroupedBuckets(payload.buckets),
  ].slice(0, ANTIGRAVITY_QUOTA_GROUP_LIMIT);
}
