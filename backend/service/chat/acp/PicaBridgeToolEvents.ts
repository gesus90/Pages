import { redactCredentials } from "@/backend/security/AgentTextSafety";

import { TOOL_CALL_TEXT_LIMIT } from "./PicaAcpToolCalls";

import type { RuntimeToolDescription } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { ChatJobToolEvent } from "@/definition/ChatJob";
import type { PicaToolOutcome } from "../PicaToolSchemas";

/** Characters of the short description of a call in the tool line. */
const SUMMARY_LIMIT = 160;

/** A text for the tool line: credentials masked, bounded. */
export function boundedToolText(text: string): string {
  const masked = redactCredentials(text.trim());
  return masked.length > TOOL_CALL_TEXT_LIMIT
    ? `${masked.slice(0, TOOL_CALL_TEXT_LIMIT)}\n[…]`
    : masked;
}

/** The first sentence of a tool's description, as its short description. */
export function toolSummary(
  catalog: readonly RuntimeToolDescription[],
  tool: string,
): string | null {
  const description = catalog.find((entry) => entry.id === tool)?.description;
  if (!description) return null;
  const sentence = /^.*?[.!?](?=\s|$)/su.exec(description)?.[0] ?? description;
  const text = sentence.replace(/\s+/gu, " ").trim();
  return text.length > SUMMARY_LIMIT
    ? `${text.slice(0, SUMMARY_LIMIT - 1)}…`
    : text;
}

function readableInput(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input))
    return JSON.stringify(input);
  const command: unknown = Reflect.get(input, "command");
  if (typeof command === "string") return command;
  return Object.keys(input).length === 0
    ? null
    : JSON.stringify(input, null, 2);
}

/** The readable text of a result: its JSON pretty printed, or as it is. */
function readableOutput(
  outcome: Pick<PicaToolOutcome, "result">,
): string | null {
  if (outcome.result === null) return null;
  try {
    return JSON.stringify(JSON.parse(outcome.result), null, 2);
  } catch {
    return outcome.result;
  }
}

/**
 * The details a call of the tool bridge shows in the tool line of the
 * answer: short description, input and, at its end, output and
 * duration, each with credentials masked.
 *
 * @remarks
 * An administrator call keeps showing name and state only; its parameters
 * and results never reach the browser.
 */
export function bridgeToolDetails(call: {
  readonly catalog: readonly RuntimeToolDescription[];
  readonly tool: string;
  readonly input: unknown;
  readonly isPrivileged: boolean;
  readonly outcome?: Pick<PicaToolOutcome, "result">;
  readonly durationMs?: number;
}): Pick<ChatJobToolEvent, "summary" | "input" | "output" | "durationMs"> {
  const summary = toolSummary(call.catalog, call.tool);
  const timing =
    call.durationMs === undefined ? {} : { durationMs: call.durationMs };
  if (call.isPrivileged) return { ...(summary ? { summary } : {}), ...timing };
  const input = readableInput(call.input);
  const output = call.outcome ? readableOutput(call.outcome) : null;
  return {
    ...(summary ? { summary } : {}),
    ...(input ? { input: boundedToolText(input) } : {}),
    ...(output ? { output: boundedToolText(output) } : {}),
    ...timing,
  };
}
