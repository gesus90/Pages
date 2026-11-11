import {
  AUTOMATION_ANSWER_BYTES,
  AUTOMATION_FORWARD_OUTPUT_BYTES,
} from "@/definition/Automation";

import type { AutomationRunOutcome } from "@/definition/Automation";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { StoredAutomationRun } from "@/backend/database/repositories/automation/AutomationRunRepository";

type Language = "de" | "en";

const TEXTS = {
  de: {
    heading: (name: string, runId: string) =>
      `[Automation „${name}“ · Lauf ${runId}]`,
    data: "Daten des Auslösers (JSON):",
    forward:
      "Ein Skript dieser Automation hat sein Ergebnis an dich weitergegeben.",
    exitCode: "Exit-Code",
    output: "Ausgabe (die letzten 64 KiB):",
    noOutput: "(keine Ausgabe)",
    notice:
      "Ergebnis eines Laufs dieser Automation. Entscheide selbst, ob und wem du davon berichtest.",
    reply:
      "Ob und wo du etwas meldest, entscheidest du selbst mit deinen Chat-Werkzeugen. Deine Schlussantwort wird im Verlauf der Automation gespeichert.",
  },
  en: {
    heading: (name: string, runId: string) =>
      `[Automation "${name}" · run ${runId}]`,
    data: "Data of the trigger (JSON):",
    forward: "A script of this automation handed its result to you.",
    exitCode: "Exit code",
    output: "Output (the last 64 KiB):",
    noOutput: "(no output)",
    notice:
      "Result of a run of this automation. Decide yourself whether and to whom you report it.",
    reply:
      "Whether and where you report something is your decision, with your chat tools. Your final answer is kept in the history of the automation.",
  },
} as const;

/**
 * Keeps the first bytes of a UTF-8 text without cutting a character.
 *
 * @param text - The text.
 * @param maximum - The most UTF-8 bytes kept.
 */
export function firstBytes(text: string, maximum: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maximum) return text;
  let end = maximum;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

/**
 * Keeps the last bytes of a UTF-8 text without cutting a character.
 *
 * @param text - The text.
 * @param maximum - The most UTF-8 bytes kept.
 */
export function lastBytes(text: string, maximum: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maximum) return text;
  let start = bytes.length - maximum;
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80)
    start += 1;
  return bytes.subarray(start).toString("utf8");
}

function dataBlock(run: StoredAutomationRun, language: Language): string[] {
  if (!run.triggerData) return [];
  return ["", TEXTS[language].data, "```json", run.triggerData, "```"];
}

/**
 * The input of an agent woken as the action of a run.
 *
 * @param automation - The automation with its instruction.
 * @param run - The run, whose trigger data is appended.
 * @param language - The creator's language.
 */
export function actionPrompt(
  automation: StoredAutomation,
  run: StoredAutomationRun,
  language: Language,
): string {
  const instruction =
    automation.action.type === "agent" ? automation.action.instruction : "";
  return [
    TEXTS[language].heading(automation.name, run.id),
    "",
    instruction,
    ...dataBlock(run, language),
    "",
    TEXTS[language].reply,
  ].join("\n");
}

/**
 * The input of an agent a script hands its result to.
 *
 * @param automation - The automation of the script.
 * @param run - The run with its trigger data.
 * @param result - The exit code and the whole output of the script.
 * @param language - The creator's language.
 */
export function forwardPrompt(
  automation: StoredAutomation,
  run: StoredAutomationRun,
  result: { readonly exitCode: number | null; readonly output: string },
  language: Language,
): string {
  const texts = TEXTS[language];
  const output = lastBytes(result.output, AUTOMATION_FORWARD_OUTPUT_BYTES);
  return [
    texts.heading(automation.name, run.id),
    texts.forward,
    "",
    `${texts.exitCode}: ${result.exitCode ?? "–"}`,
    texts.output,
    "```",
    output === "" ? texts.noOutput : output,
    "```",
    ...dataBlock(run, language),
    "",
    texts.reply,
  ].join("\n");
}

/** The structured result an agent notification carries. */
export interface AutomationNoticeData {
  readonly automationId: string;
  readonly name: string;
  readonly runId: string;
  readonly event: string;
  readonly status: AutomationRunOutcome;
  readonly at: string;
  readonly exitCode: number | null;
  readonly result: string | null;
  readonly error: string | null;
}

/**
 * The input of an agent that receives the result of a run as a notification.
 *
 * @param notice - The run's result; result and error are bounded to 4 KiB.
 * @param language - The creator's language.
 */
export function noticePrompt(
  notice: AutomationNoticeData,
  language: Language,
): string {
  const texts = TEXTS[language];
  const bounded = {
    ...notice,
    result:
      notice.result === null
        ? null
        : firstBytes(notice.result, AUTOMATION_ANSWER_BYTES),
    error:
      notice.error === null
        ? null
        : firstBytes(notice.error, AUTOMATION_ANSWER_BYTES),
  };
  return [
    texts.heading(notice.name, notice.runId),
    texts.notice,
    "",
    "```json",
    JSON.stringify(bounded, null, 2),
    "```",
  ].join("\n");
}
