import { useTranslation } from "react-i18next";

import type { AgentTaskAssignment } from "@/definition/AgentUsage";

/** Lists the tickets that execution plans bind to the agent; they are changed in the plan, not here. */
export function AgentTaskAssignments({
  assignments,
}: {
  readonly assignments: readonly AgentTaskAssignment[];
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <p className="text-sm font-medium">
        {t("settings.agents.definition.planTasks")}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.agents.definition.planTasksHint")}
      </p>
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.agents.definition.planTasksEmpty")}
        </p>
      ) : (
        <ul className="pages-selectable space-y-1 text-sm">
          {assignments.map((assignment) => (
            <li
              key={`${assignment.planId}:${assignment.taskId}`}
              className="break-words"
            >
              <span className="font-medium">{assignment.key}</span>{" "}
              {assignment.title}
              <span className="text-muted-foreground">
                {" · "}
                {t("settings.agents.definition.planTaskSource", {
                  plan: assignment.planName,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
