import type { TFunction } from "i18next";
import type { TerminalTexts } from "./terminal-lines";

/** ACP tool kinds the terminal names itself; `other` keeps the title of the call. */
const TOOL_KINDS: ReadonlySet<string> = new Set([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "fetch",
]);

/**
 * The words of the Pages terminal in the language of the reader.
 *
 * @param t - The translation function of the console.
 */
export function terminalTexts(t: TFunction): TerminalTexts {
  const key = "plans.console.terminal";
  const session = (isSameSession: boolean): string =>
    t(`${key}.${isSameSession ? "sameSession" : "newSession"}`);
  return {
    attempt: (number) => t(`${key}.attempt`, { number }),
    toolKind: (kind) =>
      TOOL_KINDS.has(kind) ? t(`${key}.toolKind.${kind}`) : null,
    done: t(`${key}.done`),
    aborted: t(`${key}.aborted`),
    running: (seconds) => t(`${key}.running`, { seconds }),
    todoActive: (id, text) => t(`${key}.todoActive`, { id, text }),
    todoDone: (id) => t(`${key}.todoDone`, { id }),
    turnEnded: t(`${key}.turnEnded`),
    interrupted: t(`${key}.interrupted`),
    reportReceived: (done, total) =>
      t(`${key}.reportReceived`, { done, total }),
    sessionClosed: t(`${key}.sessionClosed`),
    abort: (reason) => t(`${key}.abort`, { reason: failureText(t, reason) }),
    noReport: t(`${key}.noReport`),
    resume: (seconds, restart, limit, isSameSession) =>
      t(`${key}.resume`, {
        seconds,
        restart,
        limit,
        session: session(isSameSession),
      }),
    repair: (restart, limit, isSameSession) =>
      t(`${key}.repair`, { restart, limit, session: session(isSameSession) }),
    blocked: (reason, attempts) =>
      t(`${key}.blocked`, { reason: failureText(t, reason), attempts }),
    stopped: t(`${key}.stopped`),
  };
}

/**
 * The reason of a failure in words; an unknown code stays readable as it is.
 *
 * @param t - The translation function of the console.
 * @param code - The error code of the attempt.
 */
export function failureText(t: TFunction, code: string): string {
  return t([`settings.agents.error.${code}`, code]);
}
