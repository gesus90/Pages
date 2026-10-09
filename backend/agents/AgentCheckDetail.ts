import { isReasoningEffortToken } from "@/definition/AgentModelCatalog";

import type { AgentCheckDetail } from "@/definition/AgentConnection";

/** Removes arbitrary provider fields and rejects invalid measurements at the storage boundary. */
export function sanitizeCheckDetail(input: unknown): AgentCheckDetail {
  if (typeof input !== "object" || input === null) return {};
  const detail: Record<string, string | number | boolean> = {};
  for (const key of [
    "modelCount",
    "limitRemaining",
    "inputTokens",
    "outputTokens",
    "costUsd",
  ]) {
    const value: unknown = Reflect.get(input, key);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      detail[key] = value;
  }
  for (const key of ["hasMoreModels", "isFreeTier"]) {
    const value: unknown = Reflect.get(input, key);
    if (typeof value === "boolean") detail[key] = value;
  }
  const effort: unknown = Reflect.get(input, "reasoningEffort");
  if (isReasoningEffortToken(effort)) detail.reasoningEffort = effort;
  for (const key of ["model", "endpoint", "cliVersion"]) {
    const value: unknown = Reflect.get(input, key);
    if (typeof value === "string" && /^[\w.:/+@-]{1,200}$/.test(value))
      detail[key] = value;
  }
  const authMethod: unknown = Reflect.get(input, "authMethod");
  if (authMethod === "chatgpt" || authMethod === "claude.ai")
    return { ...detail, authMethod };
  return detail;
}
