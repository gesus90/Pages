import { useTranslation } from "react-i18next";

import type { AgentPlanWorkView } from "@/definition/AgentPlanWork";

/** Shows the saved assignment, exclusions and actual evidence within the existing details panel. */
export function PlanStatusWork({
  work,
}: {
  readonly work: readonly AgentPlanWorkView[] | undefined;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!work?.length) return null;
  return (
    <div className="space-y-2 border-t border-border pt-2 text-xs">
      {work.map((view) => (
        <div key={view.ticketId} className="space-y-1 wrap-anywhere">
          <p className="font-medium">
            {t("plans.workGate.scope", {
              ticket: view.ticketKey,
              revision: view.record?.revision ?? 0,
            })}
          </p>
          <p>
            {t(
              view.issues.length
                ? "plans.workGate.pending"
                : "plans.workGate.confirmed",
            )}
          </p>
          {view.record ? (
            <p className="text-muted-foreground">{view.record.note}</p>
          ) : null}
          {view.record?.scope
            .filter((item) => !item.relevant)
            .map((item) => (
              <p key={item.itemId} className="text-muted-foreground">
                {t("plans.workGate.excluded", {
                  title:
                    view.items.find((entry) => entry.id === item.itemId)
                      ?.text ?? item.itemId,
                  reason: item.reason,
                })}
              </p>
            ))}
          <ul className="space-y-1">
            {view.requiredChecks.map((name) => {
              const check = view.record?.checks.find(
                (entry) => entry.name === name,
              );
              return (
                <li key={name}>
                  {name} ·{" "}
                  {check
                    ? `${check.command} · Exit ${check.exitCode} · ${check.evidence}`
                    : t("plans.workGate.missingCheck")}
                </li>
              );
            })}
          </ul>
          {view.record?.proofs.map((proof) => (
            <p key={proof.itemId}>
              {view.items.find((item) => item.id === proof.itemId)?.text ??
                proof.itemId}
              : {proof.evidence}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
