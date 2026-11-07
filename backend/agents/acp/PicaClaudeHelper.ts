import { refusePermission, selectPermissionOption } from "./AcpPermissions";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { AcpPermissionDecision } from "./AcpDriver";

/** Where the helper puts the images it receives; the model may open exactly these files. */
const IMAGE_FILE = /^\/tmp\/pages-pica-images\/[0-9a-f-]{36}\.(?:png|jpg)$/u;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,100}$/u;
const BARE_WORD = /[A-Za-z0-9_./:-]/u;
const MAXIMUM_REQUEST_BYTES = 1024 * 1024;

function asRecord(input: unknown): Readonly<Record<string, unknown>> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : null;
}

/**
 * Splits a shell command into its literal words, or refuses it.
 *
 * @remarks
 * Only bare words of path characters, single-quoted text and the escaped
 * apostrophe are understood. Every other character, such as a substitution,
 * a pipe, a redirection, a chained command or a double quote, makes the
 * command unknown, so a shell can never be asked to interpret more than the
 * words this returns.
 */
export function parseExactCommand(command: string): string[] | null {
  const words: string[] = [];
  let word: string | null = null;
  let index = 0;
  const text = command.replace(/[ \n]+$/u, "");
  while (index < text.length) {
    const character = text.charAt(index);
    if (character === " ") {
      if (word !== null) words.push(word);
      word = null;
      index += 1;
    } else if (character === "'") {
      const end = text.indexOf("'", index + 1);
      if (end < 0) return null;
      word = (word ?? "") + text.slice(index + 1, end);
      index = end + 1;
    } else if (character === "\\" && text.charAt(index + 1) === "'") {
      word = (word ?? "") + "'";
      index += 2;
    } else if (BARE_WORD.test(character)) {
      word = (word ?? "") + character;
      index += 1;
    } else {
      return null;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

function isToolRequest(text: string): boolean {
  if (Buffer.byteLength(text, "utf8") > MAXIMUM_REQUEST_BYTES) return false;
  try {
    const input = asRecord(JSON.parse(text));
    if (input === null) return false;
    const keys = Object.keys(input);
    if (input.action === "catalog") return keys.length === 1;
    return (
      input.action === "call" &&
      typeof input.name === "string" &&
      TOOL_NAME.test(input.name) &&
      keys.every((key) => ["action", "name", "arguments"].includes(key))
    );
  } catch {
    return false;
  }
}

function isHelperCall(
  rawInput: Readonly<Record<string, unknown>>,
  helperPath: string,
): boolean {
  if (
    !Object.keys(rawInput).every((key) =>
      ["command", "description", "timeout"].includes(key),
    ) ||
    typeof rawInput.command !== "string"
  )
    return false;
  const words = parseExactCommand(rawInput.command);
  return (
    words?.length === 2 &&
    words[0] === helperPath &&
    isToolRequest(words[1] ?? "")
  );
}

function isImageRead(rawInput: Readonly<Record<string, unknown>>): boolean {
  return (
    Object.keys(rawInput).length === 1 &&
    typeof rawInput.file_path === "string" &&
    IMAGE_FILE.test(rawInput.file_path)
  );
}

/**
 * Answers a permission request of a Pica chat with Claude Code.
 *
 * @param request - The permission request of the adapter.
 * @param helperPath - The absolute path of the helper this turn may run, or `null`
 * between turns, when nothing is approved.
 * @returns Approval only for the exact helper call of this turn or for opening
 * an image file the helper wrote; every other request is refused.
 *
 * @remarks
 * Pages never approves a prefix, a command with more than the two words or a
 * tool outside these two cases. The helper itself talks to the Pages route
 * with the turn credential, which Pages checks again for every call.
 */
export function decidePicaHelperPermission(
  request: RequestPermissionRequest,
  helperPath: string | null,
): AcpPermissionDecision {
  const call = asRecord(request.toolCall);
  const rawInput = asRecord(call?.rawInput);
  const isAllowed =
    helperPath !== null &&
    rawInput !== null &&
    ((call?.name === "Bash" && isHelperCall(rawInput, helperPath)) ||
      (call?.name === "Read" && isImageRead(rawInput)));
  if (!isAllowed) return refusePermission(request);
  const outcome = selectPermissionOption(request, ["allow_once"]);
  return { outcome, isDenied: outcome.outcome !== "selected" };
}

/** The instruction a Claude Code turn receives for the helper of that turn. */
export function picaHelperUsage(helperPath: string): string {
  return [
    `Use the Bash tool with exactly this command shape, only from this message: '${helperPath}' '{"action":"catalog"}' lists the tools; '${helperPath}' '{"action":"call","name":"projects_list","arguments":{}}' calls one (replace the name and arguments; a single quote inside the JSON is written '\\'').`,
    "The result is JSON. If it lists image files, open each with the Read tool to see it.",
    "Run no other command and open no other file.",
  ].join(" ");
}
