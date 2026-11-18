import { formatMinuteTime, formatSecondTime } from "./console-time";

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
 * @param t - The translation function of the console.
 * @param language - The app language; it also sets how the times and numbers read, never the language of the browser.
 */
export function terminalTexts(t: TFunction, language: string): TerminalTexts {
  const key = "plans.console.terminal";
  const secondsFormat = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const session = (isSameSession: boolean): string =>
    t(`${key}.${isSameSession ? "sameSession" : "newSession"}`);
  return {
    attempt: (number) => t(`${key}.attempt`, { number }),
    minute: (at) => formatMinuteTime(at, language),
    clock: (at) => formatSecondTime(at, language),
    toolKind: (kind) =>
      TOOL_KINDS.has(kind) ? t(`${key}.toolKind.${kind}`) : null,
    done: t(`${key}.done`),
    aborted: t(`${key}.aborted`),
    running: t(`${key}.toolRunning`),
    exitCode: (code) => t(`${key}.toolExit`, { code }),
    lineCount: (count) => t(`${key}.toolLines`, { count }),
    duration: (milliseconds) =>
      t(`${key}.toolDuration`, {
        seconds: secondsFormat.format(milliseconds / 1000),
      }),
    showOutput: t(`${key}.toolShowOutput`),
    hideOutput: t(`${key}.toolHideOutput`),
    showJson: (lines) => t(`${key}.toolShowJson`, { count: lines }),
    hideJson: t(`${key}.toolHideJson`),
    outputLimited: t(`${key}.toolOutputLimited`),
    history: (note) => t(`${key}.history.${note}`),
    todo: (id, text) => t(`${key}.todo`, { id, text }),
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
