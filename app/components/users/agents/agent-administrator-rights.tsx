import { Check, Info } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";

interface AgentAdministratorRightsProps {
  readonly isChecked: boolean;
  readonly isSaved: boolean;
  readonly canChange: boolean;
  readonly isDisabled: boolean;
  readonly onChange: (isChecked: boolean) => void;
}

function GrantAdministratorDialog({
  onConfirm,
  onCancel,
}: {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) onCancel();
  }
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="w-[min(27.5rem,92vw)] rounded-[20px]">
        <DialogTitle className="text-base font-semibold">
          {t("agentEmployees.administratorRights.confirmTitle")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm">
          {t("agentEmployees.administratorRights.confirmIntro")}
        </DialogDescription>
        <ul className="my-3 list-disc space-y-0.5 pl-6 text-sm text-muted-foreground">
          <li>{t("agentEmployees.administratorRights.confirmUsers")}</li>
          <li>{t("agentEmployees.administratorRights.confirmConnections")}</li>
          <li>{t("agentEmployees.administratorRights.confirmProjects")}</li>
        </ul>
        <p className="text-sm text-muted-foreground">
          {t("agentEmployees.administratorRights.confirmAudit")}
        </p>
        <footer className="mt-5 flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button
              variant="outline"
              className="min-h-10 rounded-xl xl:min-h-10"
            >
              {t("agentEmployees.accessTab.cancel")}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            className="min-h-10 rounded-xl xl:min-h-10"
            onClick={onConfirm}
          >
            {t("agentEmployees.administratorRights.confirm")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function AdministratorRightsHint({
  id,
  canChange,
  isChecked,
}: {
  readonly id: string;
  readonly canChange: boolean;
  readonly isChecked: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const pendingKey = isChecked
    ? "agentEmployees.administratorRights.pending"
    : "agentEmployees.administratorRights.pendingRevocation";
  return (
    <p
      id={id}
      className={cn(
        "flex items-start gap-2 text-xs",
        canChange ? "text-warning" : "text-muted-foreground",
      )}
      role="status"
    >
      <Info aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
      {t(
        canChange ? pendingKey : "agentEmployees.administratorRights.adminOnly",
      )}
    </p>
  );
}

/** Edits the grant in the panel draft after confirming a new assignment. */
export function AgentAdministratorRights({
  isChecked,
  isSaved,
  canChange,
  isDisabled,
  onChange,
}: AgentAdministratorRightsProps): React.ReactElement {
  const { t } = useTranslation();
  const labelId = useId();
  const descriptionId = useId();
  const hintId = useId();
  const [isConfirming, setConfirming] = useState(false);
  const isLocked = !canChange || isDisabled;
  const isPending = isChecked !== isSaved;

  function change(checked: boolean): void {
    if (isLocked) return;
    if (checked && !isSaved) setConfirming(true);
    else onChange(checked);
  }
  function confirm(): void {
    setConfirming(false);
    if (!isLocked) onChange(true);
  }
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-sm font-[650]">
        {t("agentEmployees.administratorRights.title")}
      </legend>
      <label
        className={cn(
          "flex items-start gap-3 rounded-[16px] border px-4 py-3.5",
          isChecked
            ? "border-destructive bg-destructive-subtle"
            : "border-border bg-surface",
          isLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        )}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          checked={isChecked}
          disabled={isLocked}
          aria-labelledby={labelId}
          aria-describedby={
            canChange ? descriptionId : `${descriptionId} ${hintId}`
          }
          onChange={(event) => change(event.currentTarget.checked)}
        />
        <span
          aria-hidden="true"
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
            isChecked
              ? "border-destructive bg-destructive"
              : "border-border-strong",
          )}
        >
          {isChecked ? (
            <Check className="size-3 text-primary-foreground" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-col">
          <span
            id={labelId}
            className={cn(
              "text-[13px] font-[650]",
              isChecked && "text-destructive",
            )}
          >
            {t("agentEmployees.administratorRights.label")}
          </span>
          <span
            id={descriptionId}
            className="text-xs leading-[18px] text-muted-foreground"
          >
            {t("agentEmployees.administratorRights.description")}
          </span>
        </span>
      </label>
      {!canChange || isPending ? (
        <AdministratorRightsHint
          id={hintId}
          canChange={canChange}
          isChecked={isChecked}
        />
      ) : null}
      {isConfirming ? (
        <GrantAdministratorDialog
          onConfirm={confirm}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </fieldset>
  );
}
