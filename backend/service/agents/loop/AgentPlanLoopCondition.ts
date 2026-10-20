import {
  isPlanLoopConditionActive,
  parsePlanLoopPath,
} from "@/definition/AgentPlanLoop";

import type {
  AgentPlanLoop,
  AgentPlanLoopValue,
  PlanLoopPathSegment,
} from "@/definition/AgentPlanLoop";
import type {
  AgentPlanLoopConditionFailure,
  AgentPlanLoopConditionOutcome,
  AgentPlanLoopFound,
} from "@/definition/AgentPlanLoopRun";

/** The info string of the one fenced block that carries the result of a loop node. */
export const LOOP_RESULT_MARKER = "pages-loop-result";

const MARKED_BLOCK = new RegExp(
  `^\`\`\`${LOOP_RESULT_MARKER}[ \\t]*\\r?\\n([\\s\\S]*?)^\`\`\`[ \\t]*$`,
  "gmu",
);

type Extraction =
  | { readonly value: unknown }
  | { readonly failure: AgentPlanLoopConditionFailure };

/**
 * Reads the one JSON value a node's answer carries for its loop.
 *
 * @param output - The stored answer of an agent or the output of a script.
 * @returns The value, or the reason there is none.
 *
 * @remarks
 * The contract has two forms and nothing else. An answer that is one JSON
 * value as a whole is that value. Otherwise the answer holds exactly one
 * fenced block marked `pages-loop-result`, which holds one JSON value; the
 * text around it is ignored. No block and no whole-answer JSON is
 * `plan_loop_output_missing`, more than one block is
 * `plan_loop_output_ambiguous`, a block that is no JSON is
 * `plan_loop_output_invalid`. Reports and other fenced blocks are never
 * read as a result, and nothing is guessed from prose.
 */
export function extractLoopJson(output: string | null): Extraction {
  const text = output?.trim() ?? "";
  if (text === "") return { failure: "plan_loop_output_missing" };
  const blocks = [...text.matchAll(MARKED_BLOCK)];
  if (blocks.length > 1) return { failure: "plan_loop_output_ambiguous" };
  const block = blocks[0];
  if (block) return parseJson(block[1] ?? "", "plan_loop_output_invalid");
  return parseJson(text, "plan_loop_output_missing");
}

function parseJson(
  text: string,
  failure: AgentPlanLoopConditionFailure,
): Extraction {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { failure };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Walks the path; a missing property or index is `undefined`, never a guess. */
function valueAt(
  root: unknown,
  segments: readonly PlanLoopPathSegment[],
): { readonly isFound: boolean; readonly value: unknown } {
  let current = root;
  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length)
        return { isFound: false, value: undefined };
      current = current[segment] as unknown;
    } else {
      if (!isRecord(current) || !Object.hasOwn(current, segment))
        return { isFound: false, value: undefined };
      current = current[segment];
    }
  }
  return { isFound: true, value: current };
}

function describeFound(value: unknown): AgentPlanLoopFound | null {
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (typeof value === "number" && Number.isFinite(value))
    return { type: "number", value };
  if (typeof value === "string") return { type: "string", value };
  if (Array.isArray(value)) return { type: "array" };
  return isRecord(value) ? { type: "object" } : null;
}

function isSameValue(
  found: AgentPlanLoopValue,
  expected: AgentPlanLoopValue,
): boolean {
  if (found.type === "null" || expected.type === "null")
    return found.type === expected.type;
  return found.type === expected.type && found.value === expected.value;
}

/**
 * Evaluates the end condition of a loop after a complete iteration.
 *
 * @param loop - The frozen loop with its condition.
 * @param outputs - The outputs of this iteration's members by node ID.
 * @returns `not_evaluated` when the condition is off or the loop counts
 * `expected`; otherwise the verdict, or why none could be reached.
 *
 * @remarks
 * Deterministic and type strict: `true` is never the text "true", a number or
 * `null`. A type that differs from the expected one is a failure, not
 * `false`; so are a missing source, path, field or JSON.
 */
export function evaluateLoopCondition(
  loop: AgentPlanLoop,
  outputs: ReadonlyMap<string, string | null>,
): AgentPlanLoopConditionOutcome {
  const condition = loop.condition;
  if (loop.countMode === "expected")
    return { state: "not_evaluated", reason: "expected" };
  if (!condition || !isPlanLoopConditionActive(loop))
    return { state: "not_evaluated", reason: "disabled" };
  if (!outputs.has(condition.sourceNodeId))
    return { state: "failed", code: "plan_loop_condition_source" };
  const segments = parsePlanLoopPath(condition.outputPath);
  if (segments === null)
    return { state: "failed", code: "plan_loop_condition_path" };
  const extracted = extractLoopJson(
    outputs.get(condition.sourceNodeId) ?? null,
  );
  if ("failure" in extracted)
    return { state: "failed", code: extracted.failure };
  const at = valueAt(extracted.value, segments);
  if (!at.isFound)
    return { state: "failed", code: "plan_loop_condition_field" };
  const found = describeFound(at.value);
  if (found === null || found.type !== condition.expected.type)
    return { state: "failed", code: "plan_loop_condition_type" };
  return {
    state: "evaluated",
    isMet: isSameValue(found, condition.expected),
    found,
  };
}
