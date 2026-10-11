import type { StoredAgentImportItem } from "@/backend/database/repositories/agents/AgentImportRepository";
import type {
  AgentStructuredImportItem,
  AgentStructuredReason,
} from "@/definition/AgentStructuredImportManifest";
import type { PagesAgentApiErrorCode } from "@/definition/PagesAgentApi";
import type { StructuredStep } from "./StructuredImportPlanner";

/** A step that cannot run because an object it builds on is neither there nor going to be. */
export class StructuredStepBlockedError extends Error {
  public constructor() {
    super("A source this one builds on is unavailable.");
  }
}

/**
 * Turns a stored outcome into the public item, whatever kind of source wrote it.
 *
 * @param item - An outcome of the A9.8 source service or of a structured step.
 * @returns The public item; a wiki outcome has no kind of its own and becomes `wiki`.
 */
export function toStructuredItem(
  item: StoredAgentImportItem,
): AgentStructuredImportItem {
  if ("kind" in item) return item;
  return {
    kind: "wiki",
    sourceKey: item.sourceKey,
    targetKey: item.targetKey,
    action: item.action,
    targetId: item.pageId,
    key: null,
    link: item.link,
    parentId: null,
    milestoneId: null,
    assets: item.assets,
    reason: null,
    errorCode: item.errorCode,
  };
}

/** The target of an outcome, or `null` when nothing exists to build on. */
export function storedTargetId(
  item: StoredAgentImportItem | null,
): string | null {
  if (!item || item.action === "failed") return null;
  return "kind" in item ? item.targetId : item.pageId;
}

/**
 * Describes a step that did not complete.
 *
 * @param step - The step that failed.
 * @param code - The fixed business code of the failure.
 * @param reason - Why, when the failure is a known one.
 * @returns A conflict for `CONFLICT`, a failure for everything else.
 */
export function failedStructuredItem(
  step: StructuredStep,
  code: PagesAgentApiErrorCode,
  reason: AgentStructuredReason | null,
): AgentStructuredImportItem {
  return {
    kind: step.kind,
    sourceKey: step.key,
    targetKey: step.key,
    action: code === "CONFLICT" ? "conflict" : "failed",
    targetId: null,
    key: null,
    link: null,
    parentId: null,
    milestoneId: null,
    assets: [],
    reason,
    errorCode: code,
  };
}
