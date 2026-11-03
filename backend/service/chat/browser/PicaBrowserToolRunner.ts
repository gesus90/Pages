import { PicaAdminError } from "../admin/PicaAdminContracts";
import { browserFailure } from "./PicaBrowserNavigation";
import { observePage } from "./PicaBrowserObservation";
import { browserFailureOutcome, browserOutcome } from "./PicaBrowserOutcome";

import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { PicaBrowserReply } from "./PicaBrowserContracts";
import type { PicaObservationOptions } from "./PicaBrowserObservation";
import type { PicaBrowserSession } from "./PicaBrowserSession";

/** One call against an open browser. */
export interface PicaBrowserCall {
  /** Does the work and returns the line for the action log. */
  readonly work: (session: PicaBrowserSession) => Promise<string>;
  /** How the page is observed afterwards; defaults to a brief observation. */
  readonly observe?: PicaObservationOptions;
  /** Replaces the observation, for calls that answer with a list or end the browser. */
  readonly answer?: (session: PicaBrowserSession) => Promise<PicaBrowserReply>;
}

const GATE_CODES: ReadonlySet<string> = new Set([
  "PAUSED_BY_ADMIN",
  "ADMIN_HAS_CONTROL",
  "STOPPED_BY_ADMIN",
]);

function gateOutcome(
  session: PicaBrowserSession,
  code: string,
): PicaToolOutcome {
  return browserFailureOutcome(code, {
    facts: {
      browserId: session.id,
      state: session.currentState,
      ...(session.handoverReason
        ? { handoverReason: session.handoverReason }
        : {}),
    },
  });
}

async function failureAfter(
  session: PicaBrowserSession,
  error: unknown,
): Promise<PicaToolOutcome> {
  const failure = browserFailure(session, error);
  if (GATE_CODES.has(failure.message))
    return gateOutcome(session, failure.message);
  session.record("pica", `Failed: ${failure.message}`, "failed");
  // The page after the failure is the best hint; it is left out when the browser is gone.
  let observation: PicaBrowserReply | null = null;
  if (session.currentState === "running") {
    try {
      observation = await observePage(session, { detail: "screen" });
    } catch {
      observation = null;
    }
  }
  return browserFailureOutcome(failure.message, { observation });
}

/**
 * Runs one call of the model against a browser the administrator may still stop.
 *
 * @param session - The browser of the call.
 * @param signal - The signal of the calling job.
 * @param call - The work and how to observe the result.
 * @returns The observation with screenshot, or a failure that says what to do next.
 *
 * @remarks
 * The call waits briefly while the administrator pauses or drives the
 * browser, and answers with the state when that lasts. Calls of one browser
 * run one after another. A failed action still returns what the page looks
 * like, so the model can recover.
 */
export async function executeBrowserCall(
  session: PicaBrowserSession,
  signal: AbortSignal,
  call: PicaBrowserCall,
): Promise<PicaToolOutcome> {
  try {
    await session.admit(signal);
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    return failureAfter(session, error);
  }
  return session.queue.run(async () => {
    try {
      // The state may have changed while the call waited for its turn.
      await session.admit(signal);
      const summary = await call.work(session);
      session.record("pica", summary, "completed");
      return browserOutcome(
        call.answer
          ? await call.answer(session)
          : await observePage(session, call.observe ?? { detail: "brief" }),
      );
    } catch (error: unknown) {
      if (signal.aborted && !(error instanceof PicaAdminError)) throw error;
      return failureAfter(session, error);
    }
  });
}
