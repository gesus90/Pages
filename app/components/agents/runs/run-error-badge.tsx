import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentRunErrorClass } from "@/definition/AgentRunDiagnosis";

const CLASS_TONES: Readonly<Record<AgentRunErrorClass, string>> = {
  model: "bg-warning-subtle text-warning",
  tool_missing: "bg-warning-subtle text-warning",
  timeout: "bg-warning-subtle text-warning",
  git: "bg-info-subtle text-info",
  workspace_busy: "bg-info-subtle text-info",
  permission: "bg-destructive-subtle text-destructive",
  plan_invalid: "bg-destructive-subtle text-destructive",
  process_crash: "bg-destructive-subtle text-destructive",
  runner_unavailable: "bg-warning-subtle text-warning",
  acceptance_failed: "bg-destructive-subtle text-destructive",
  unknown: "bg-muted text-muted-foreground",
};

/** The fixed error class of a failure as a small label; its code is the tooltip. */
export function RunErrorBadge({
  errorClass,
  errorCode,
}: {
  readonly errorClass: AgentRunErrorClass;
  readonly errorCode?: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <span
      title={errorCode ?? undefined}
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium",
        CLASS_TONES[errorClass],
      )}
    >
      {t(`runDiagnosis.errorClass.${errorClass}.label`)}
    </span>
  );
}

/** What can be done about a class, in the words of the interface. */
export function RunErrorHint({
  errorClass,
}: {
  readonly errorClass: AgentRunErrorClass;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <p className="text-xs text-muted-foreground">
      {t(`runDiagnosis.errorClass.${errorClass}.hint`)}
    </p>
  );
}
