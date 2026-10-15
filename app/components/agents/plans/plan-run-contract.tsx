import { useTranslation } from "react-i18next";

import type { TFunction } from "i18next";
import type {
  AgentPlanAcceptance,
  AgentPlanContract,
  AgentPlanContractItem,
  AgentPlanCriterionStatus,
} from "@/definition/AgentPlanSession";

function ticketNote(
  item: AgentPlanContractItem,
  checked: boolean | null | undefined,
  t: TFunction,
): string {
  if (!item.ticket) return "";
  const state =
    checked === undefined || checked === null
      ? ` · ${t("plans.session.ticketUnknown")}`
      : ` · ${t(checked ? "plans.session.ticketChecked" : "plans.session.ticketOpen")}`;
  return ` (${item.ticket.key}${state})`;
}

function criterionNote(
  status: AgentPlanCriterionStatus | undefined,
  t: TFunction,
  issues: readonly string[],
): string {
  if (!status) return "";
  if (issues.includes(`criterion_missing:${status.id}`))
    return ` — ${t("plans.session.unknown")}`;
  if (issues.includes(`evidence_missing:${status.id}`))
    return ` — ${t("plans.session.unproven")}`;
  const verdict = t(status.met ? "plans.session.met" : "plans.session.unmet");
  return status.evidence
    ? ` — ${verdict}: ${status.evidence}`
    : ` — ${verdict}`;
}

function Todos({
  contract,
  acceptance,
}: {
  readonly contract: AgentPlanContract;
  readonly acceptance: AgentPlanAcceptance | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ul className="space-y-0.5">
      {contract.todos.map((todo) => {
        const status = acceptance?.todos.find((entry) => entry.id === todo.id);
        return (
          <li key={todo.id} className="break-words">
            <span className="font-medium">{todo.id}</span> {todo.text}
            {todo.ticket ? ` (${todo.ticket.key})` : ""}
            {status
              ? ` — ${t(`plans.session.todoStatus.${status.status}`)}`
              : ""}
          </li>
        );
      })}
    </ul>
  );
}

function Criteria({
  contract,
  acceptance,
}: {
  readonly contract: AgentPlanContract;
  readonly acceptance: AgentPlanAcceptance | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ul className="space-y-0.5">
      {contract.criteria.map((criterion) => {
        const status = acceptance?.criteria.find(
          (entry) => entry.id === criterion.id,
        );
        return (
          <li key={criterion.id} className="break-words">
            <span className="font-medium">{criterion.id}</span> {criterion.text}
            {ticketNote(criterion, status?.ticketChecked, t)}
            {criterionNote(status, t, acceptance?.issues ?? [])}
          </li>
        );
      })}
    </ul>
  );
}

/** Shows reconciled progress and report diagnostics separately from execution status. */
export function PlanRunContract({
  contract,
  acceptance,
  requiresAcceptance = false,
}: {
  readonly contract: AgentPlanContract;
  readonly acceptance: AgentPlanAcceptance | null;
  readonly requiresAcceptance?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const verdict = acceptance?.verdict ?? "pending";
  const isTodoList = contract.completion === "todos";
  const label = t(
    `plans.session.${isTodoList ? "todoVerdict" : "verdict"}.${verdict}`,
  );
  return (
    <details
      className="text-xs"
      open={verdict === "rejected" || verdict === "open"}
    >
      <summary className="cursor-pointer font-medium">{label}</summary>
      <div className="pages-selectable mt-1 space-y-2">
        <p className="text-muted-foreground">
          {t(
            requiresAcceptance
              ? "plans.groups.acceptanceHint"
              : "plans.session.diagnosticHint",
          )}
        </p>
        <h4 className="font-medium">{t("plans.session.todos")}</h4>
        <Todos contract={contract} acceptance={acceptance} />
        {contract.criteria.length > 0 ? (
          <>
            <h4 className="font-medium">{t("plans.session.criteria")}</h4>
            <Criteria contract={contract} acceptance={acceptance} />
          </>
        ) : null}
        {acceptance && acceptance.issues.length > 0 ? (
          <p className="text-muted-foreground">
            {t("plans.session.issues")}: {acceptance.issues.join(", ")}
          </p>
        ) : null}
        {acceptance && acceptance.decisions.length > 0 ? (
          <>
            <h4 className="font-medium">{t("plans.session.decisions")}</h4>
            <ul className="list-disc pl-4">
              {acceptance.decisions.map((decision) => (
                <li key={decision}>{decision}</li>
              ))}
            </ul>
          </>
        ) : null}
        {acceptance?.summary ? <p>{acceptance.summary}</p> : null}
      </div>
    </details>
  );
}
