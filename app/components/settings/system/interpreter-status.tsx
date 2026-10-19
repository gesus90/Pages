import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { InterpreterCheck } from "@/definition/InterpreterProfile";
import type { TFunction } from "i18next";

import type { InterpreterRow } from "./interpreter-editor-state";

interface InterpreterStatusProps {
  readonly row: InterpreterRow;
  readonly canCheck: boolean;
  readonly onCheck: () => void;
}

function describeCheck(check: InterpreterCheck, t: TFunction): string {
  if (check.status === "ok") return t("settings.system.interpreters.ok");
  return `${t(`settings.system.interpreters.errors.${check.error ?? "failed"}`)} ${check.diagnostic ?? ""}`.trim();
}

/** Keeps statuses and explicit Sync in the same centered geometry, with accessible diagnostics. */
export function InterpreterStatus({
  row,
  canCheck,
  onCheck,
}: InterpreterStatusProps): React.ReactElement {
  const { t } = useTranslation();
  const check = row.check?.path === row.profile.path ? row.check : undefined;
  const isOk = check?.status === "ok";
  const hasError = check?.status === "error";
  if (!row.isChecking && !check)
    return (
      <Button
        size="xs"
        className="h-11 w-full rounded-md sm:h-8 sm:min-h-8"
        onClick={onCheck}
        disabled={!canCheck}
        aria-label={t("settings.system.interpreters.syncProfile", {
          name: row.profile.name,
        })}
      >
        Sync
      </Button>
    );
  let label = t("settings.system.interpreters.checking");
  if (isOk) label = t("settings.system.interpreters.ok");
  if (hasError) label = t("settings.system.interpreters.errorStatus");
  const diagnostic = check ? describeCheck(check, t) : label;
  return (
    <button
      type="button"
      disabled={row.isChecking || !canCheck}
      onClick={onCheck}
      className={cn(
        "flex h-11 w-full items-center justify-center gap-1 rounded-md text-xs font-semibold sm:h-8",
        "bg-muted text-muted-foreground",
        isOk && "bg-success-subtle text-success",
        hasError && "bg-destructive-subtle text-destructive",
      )}
      aria-label={`${row.profile.name}: ${diagnostic}`}
      title={diagnostic}
    >
      <span aria-hidden="true">{row.isChecking ? "…" : "●"}</span>
      {label}
    </button>
  );
}
