import type { StoredAgentToolUse } from "@/backend/database/repositories/employee/AgentToolUseRepository";
import type {
  AgentDreamToolCall,
  AgentDreamToolDigest,
} from "./AgentLearningPrompt";

/** Tools the digest lists with their counts at most. */
const LISTED_TOOLS = 20;
/** Repeated calls the digest lists at most. */
const LISTED_REPEATS = 15;
/** Failed calls the digest lists at most. */
const LISTED_FAILURES = 15;
/** Calls of the trace the digest lists at most. */
const TRACE_CALLS = 80;
/** How often a call must repeat to count as repeated. */
const REPEAT_FROM = 2;
/** Characters of the input and the result in a line of the trace. */
const TRACE_INPUT_CHARACTERS = 90;
const TRACE_OUTPUT_CHARACTERS = 60;

function callOf(use: StoredAgentToolUse): AgentDreamToolCall {
  return {
    tool: use.tool,
    input: use.input,
    output: use.output,
    error: use.error,
  };
}

function cut(text: string, maximum: number): string {
  const characters = Array.from(text);
  return characters.length <= maximum
    ? text
    : `${characters.slice(0, maximum).join("")}…`;
}

function traceLine(use: StoredAgentToolUse): string {
  const status = use.isOk ? "ok" : `FEHLER ${use.error ?? ""}`.trim();
  const output = use.isOk
    ? ` → ${cut(use.output, TRACE_OUTPUT_CHARACTERS)}`
    : "";
  return `${use.tool} ${cut(use.input, TRACE_INPUT_CHARACTERS)} → ${status}${output}`;
}

/**
 * Condenses the tool calls since the last dream run into what shows how the
 * agent works: which tools it uses and where they fail, which calls it makes
 * again and again with the same input (paths, IDs, fixed values) and the
 * order of its newest calls.
 *
 * @param uses - The tool calls the run reads, the oldest first.
 */
export function digestToolUses(
  uses: readonly StoredAgentToolUse[],
): AgentDreamToolDigest {
  const perTool = new Map<string, { calls: number; failures: number }>();
  const repeats = new Map<
    string,
    { call: AgentDreamToolCall; calls: number }
  >();
  const failures = new Map<string, AgentDreamToolCall>();
  for (const use of uses) {
    const counts = perTool.get(use.tool) ?? { calls: 0, failures: 0 };
    counts.calls += 1;
    if (!use.isOk) counts.failures += 1;
    perTool.set(use.tool, counts);
    const key = `${use.tool}\u0000${use.input}`;
    const repeat = repeats.get(key) ?? { call: callOf(use), calls: 0 };
    repeat.calls += 1;
    repeats.set(key, repeat);
    if (!use.isOk) failures.set(`${key}\u0000${use.error ?? ""}`, callOf(use));
  }
  return {
    tools: [...perTool.entries()]
      .map(([tool, counts]) => ({ tool, ...counts }))
      .sort((left, right) => right.calls - left.calls)
      .slice(0, LISTED_TOOLS),
    repeated: [...repeats.values()]
      .filter((entry) => entry.calls >= REPEAT_FROM)
      .sort((left, right) => right.calls - left.calls)
      .slice(0, LISTED_REPEATS)
      .map((entry) => ({ ...entry.call, calls: entry.calls })),
    failures: [...failures.values()].slice(-LISTED_FAILURES),
    trace: uses.slice(-TRACE_CALLS).map(traceLine),
  };
}
