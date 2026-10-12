import { readAgentObject } from "@/backend/agents/AgentPayload";

/** Info string of the fenced block in which the agent requests one Pages action. */
export const CHAT_ACTION_FENCE = "pages-action";

const ACTION_BLOCK = new RegExp(
  `\`\`\`${CHAT_ACTION_FENCE}[^\\n]*\\n([\\s\\S]*?)\\n?\`\`\``,
  "u",
);

/** What one reply of the model asks for. */
export type ChatModelReply =
  | { readonly kind: "answer"; readonly text: string }
  | {
      readonly kind: "action";
      readonly operation: string;
      readonly parameters: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: "invalid" };

/**
 * Reads a model reply as a final answer or as a request for one action.
 *
 * @param output - The complete text the model returned.
 * @returns The answer for the person, the requested action, or `invalid` for a
 * malformed action block.
 *
 * @remarks
 * Only Pages executes actions. A reply with an action block never reaches the
 * person; its JSON must name an operation and an object of parameters.
 */
export function readChatModelReply(output: string): ChatModelReply {
  const block = ACTION_BLOCK.exec(output);
  if (!block) return { kind: "answer", text: output.trim() };
  let parsed: unknown;
  try {
    parsed = JSON.parse(block[1]);
  } catch {
    return { kind: "invalid" };
  }
  const action = readAgentObject(parsed);
  const parameters = action.parameters ?? {};
  if (
    typeof action.operation !== "string" ||
    typeof parameters !== "object" ||
    parameters === null ||
    Array.isArray(parameters)
  )
    return { kind: "invalid" };
  return {
    kind: "action",
    operation: action.operation,
    parameters: readAgentObject(parameters),
  };
}
