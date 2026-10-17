import type { AgentCapabilities } from "@agentclientprotocol/sdk";
import type { AgentSessionContinuation } from "@/definition/AgentSessionJournal";

/** What the adapter confirmed in `initialize` about continuing a session in a new process. */
export interface AcpContinuationCapabilities {
  /** `session/load`, which replays the history as updates. */
  readonly canLoad: boolean;
  /** `session/resume`, which continues without replay. */
  readonly canResume: boolean;
}

/** What decides how the next instruction can continue a session. */
export interface ContinuationFacts {
  /** The executor still has every right the run needs. */
  readonly isAuthorized: boolean;
  /** Model, connection, workspace and options are the ones the session started with. */
  readonly isConfigurationCompatible: boolean;
  /** The native session of this attempt is open in a running adapter process. */
  readonly isProcessAlive: boolean;
  /** The protocol session ID the adapter issued; `null` when it never issued one. */
  readonly acpSessionId: string | null;
  /** What the adapter confirmed; `null` when it was never recorded. */
  readonly capabilities: AcpContinuationCapabilities | null;
  /** Pages has a path that resumes or loads this kind of session. */
  readonly canUseCapabilities: boolean;
  /** A new session may start with a bounded summary of the stored history. */
  readonly canReconstruct: boolean;
  /** The plan has a checkpoint to continue from, apart from the native session. */
  readonly hasPlanCheckpoint: boolean;
}

/**
 * Reads the continuation capabilities from an `initialize` response.
 *
 * @param capabilities - `agentCapabilities` as the adapter announced them.
 * @returns Only what the adapter confirmed; an absent field is no capability.
 */
export function readContinuationCapabilities(
  capabilities: AgentCapabilities | null | undefined,
): AcpContinuationCapabilities {
  return {
    canLoad: capabilities?.loadSession === true,
    canResume:
      capabilities?.sessionCapabilities?.resume !== undefined &&
      capabilities.sessionCapabilities.resume !== null,
  };
}

/** `resume` or `load` where the adapter confirmed it and Pages has a path for it. */
function nativeContinuation(
  facts: ContinuationFacts,
): "resume" | "load" | null {
  if (facts.acpSessionId === null || !facts.canUseCapabilities) return null;
  if (facts.capabilities?.canResume) return "resume";
  if (facts.capabilities?.canLoad) return "load";
  return null;
}

/** Why an ended native session cannot continue. */
function endedReason(facts: ContinuationFacts): string {
  const isOfferedByAdapter =
    facts.capabilities?.canResume === true ||
    facts.capabilities?.canLoad === true;
  // The adapter could continue, but Pages has no path for it: say so instead of offering it.
  return isOfferedByAdapter && !facts.canUseCapabilities
    ? "pages_resume_unavailable"
    : "native_session_ended";
}

/**
 * Decides how the next instruction continues a session, truthfully.
 *
 * @param facts - What the server knows about the attempt now.
 * @returns `live` for an open native session; `resume` or `load` only with a
 * confirmed capability; `reconstructed` for a new native session that must be
 * marked as such; otherwise `unavailable` with its reason.
 *
 * @remarks
 * Rights and configuration come first: a changed model or workspace never
 * continues silently in another context. A plan checkpoint is reported apart,
 * because continuing the plan is not continuing the native session.
 */
export function decideContinuation(
  facts: ContinuationFacts,
): AgentSessionContinuation {
  const { hasPlanCheckpoint } = facts;
  if (!facts.isAuthorized)
    return { mode: "unavailable", reason: "access_denied", hasPlanCheckpoint };
  if (!facts.isConfigurationCompatible)
    return {
      mode: "unavailable",
      reason: "configuration_incompatible",
      hasPlanCheckpoint,
    };
  if (facts.isProcessAlive)
    return { mode: "live", reason: null, hasPlanCheckpoint };
  const native = nativeContinuation(facts);
  if (native !== null) return { mode: native, reason: null, hasPlanCheckpoint };
  if (facts.canReconstruct)
    return {
      mode: "reconstructed",
      reason:
        facts.capabilities === null
          ? "capabilities_unknown"
          : "native_session_ended",
      hasPlanCheckpoint,
    };
  return { mode: "unavailable", reason: endedReason(facts), hasPlanCheckpoint };
}

/** Room kept for the line that names how many entries were left out. */
const OMISSION_RESERVE = 40;

function newestLines(history: readonly string[], budget: number): string[] {
  const kept: string[] = [];
  let size = 0;
  for (const line of [...history].reverse()) {
    if (size + line.length + 1 > budget) break;
    kept.unshift(line);
    size += line.length + 1;
  }
  return kept;
}

/**
 * Builds the bounded context a reconstructed session starts with.
 *
 * @param history - Redacted history lines, oldest first.
 * @param limit - The most characters the context may take.
 * @returns A text that says it is a reconstruction and keeps the newest lines.
 */
export function reconstructedContext(
  history: readonly string[],
  limit: number,
): string {
  const header =
    "Pages started a new session. The earlier native session could not be continued; this is a shortened summary of its stored history, not its full context.";
  const budget = limit - header.length;
  const all = newestLines(history, budget);
  const kept =
    all.length === history.length
      ? all
      : newestLines(history, budget - OMISSION_RESERVE);
  const omitted = history.length - kept.length;
  return [
    header,
    ...(omitted > 0 ? [`[${omitted} earlier entries omitted]`] : []),
    ...kept,
  ].join("\n");
}
