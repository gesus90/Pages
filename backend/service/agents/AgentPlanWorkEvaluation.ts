import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import type { AgentChecklistItem } from "@/definition/AgentTicketChecklist";
import type {
  AgentPlanWorkRecord,
  AgentPlanWorkItem,
} from "@/definition/AgentPlanWork";
import type { MaterializedChecklist } from "@/backend/service/task/TicketChecklist";

/** Hashes only explicit relevant IDs and their observed state, never foreign checkbox activity. */
export function planWorkScopeHash(
  items: readonly AgentChecklistItem[],
  scope: readonly AgentPlanWorkItem[],
): string {
  return planContentDigest(
    items
      .filter((item) =>
        scope.some((entry) => entry.itemId === item.id && entry.relevant),
      )
      .map((item) => [item.id, item.checked]),
  );
}

function itemIssues(
  item: AgentPlanWorkItem,
  input: {
    readonly checklist: Pick<MaterializedChecklist, "items">;
    readonly record: AgentPlanWorkRecord;
  },
): readonly string[] {
  const current = input.checklist.items.find(
    (entry) => entry.id === item.itemId,
  );
  const issues: string[] = [];
  if (!current) issues.push(`work_removed:${item.itemId}`);
  if (!item.relevant) {
    if (!item.reason.trim())
      issues.push(`work_exclusion_unexplained:${item.itemId}`);
    return issues;
  }
  if (!current?.checked) issues.push(`todo_open:${item.itemId}`);
  if (
    !input.record.proofs.some(
      (proof) => proof.itemId === item.itemId && proof.evidence.trim(),
    )
  )
    issues.push(`work_proof_missing:${item.itemId}`);
  return issues;
}

function missingChecks(
  record: AgentPlanWorkRecord,
  required: readonly string[],
): readonly string[] {
  return required
    .filter((name) => {
      const checks = record.checks.filter((check) => check.name === name);
      return (
        checks.length !== 1 ||
        checks[0].exitCode !== 0 ||
        !checks[0].command.trim() ||
        !checks[0].evidence.trim()
      );
    })
    .map((name) => `work_check_missing:${name}`);
}

/** Evaluates fresh state; neither a checked box nor a process exit supplies missing evidence. */
export function planWorkIssues(input: {
  readonly checklist: Pick<MaterializedChecklist, "items" | "contentHash">;
  readonly requirementsHash: string;
  readonly requiredChecks: readonly string[];
  readonly record: AgentPlanWorkRecord | null;
}): readonly string[] {
  const { checklist, record } = input;
  if (!record) return ["work_scope_missing"];
  const issues: string[] = [];
  if (record.requirementsHash !== input.requirementsHash)
    issues.push("work_scope_changed");
  if (
    !record.confirmed ||
    record.scopeHash !== planWorkScopeHash(checklist.items, record.scope)
  )
    issues.push("work_confirmation_stale");
  const selected = record.scope.filter((item) => item.relevant);
  if (!selected.length) issues.push("work_scope_empty");
  const assigned = new Set(record.scope.map((item) => item.itemId));
  if (assigned.size !== record.scope.length)
    issues.push("work_scope_duplicate");
  for (const item of checklist.items)
    if (!assigned.has(item.id)) issues.push(`work_unassigned:${item.id}`);
  for (const item of record.scope)
    issues.push(...itemIssues(item, { checklist, record }));
  issues.push(...missingChecks(record, input.requiredChecks));
  return issues;
}
