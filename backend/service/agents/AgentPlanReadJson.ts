import type { AgentPlanRead } from "@/definition/AgentPlanOperations";

function isProperty(value: unknown): boolean {
  return (
    value !== undefined &&
    typeof value !== "function" &&
    typeof value !== "symbol"
  );
}

function* arrayParts(entries: readonly unknown[]): Generator<string> {
  yield "[";
  for (const [index, entry] of entries.entries()) {
    if (index > 0) yield ",";
    if (isProperty(entry)) yield* jsonParts(entry);
    else yield "null";
  }
  yield "]";
}

function* objectParts(entry: object): Generator<string> {
  yield "{";
  let first = true;
  for (const [key, value] of Object.entries(entry)) {
    if (!isProperty(value)) continue;
    if (!first) yield ",";
    first = false;
    yield JSON.stringify(key);
    yield ":";
    yield* jsonParts(value);
  }
  yield "}";
}

function* jsonParts(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    yield* arrayParts(value);
    return;
  }
  if (value !== null && typeof value === "object") {
    yield* objectParts(value);
    return;
  }
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError("Plan contains a non-JSON value");
  yield text;
}

/** Serializes the JSON-only plan projection as pieces without building its complete text. */
export function* planReadJson(result: AgentPlanRead): Generator<string> {
  yield* jsonParts(result);
}
