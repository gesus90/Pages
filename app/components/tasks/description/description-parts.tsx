import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";
import { formatShortcut } from "@/app/lib/editor/editor-shortcuts";
import { WORK_ITEM_LIMITS } from "@/definition/Task";

import type { DescriptionLeaveGuard } from "./use-description-leave-guard";
import type { TicketDescriptionState } from "./use-ticket-description";

const STATUS_KEYS: Readonly<Record<string, string>> = {
  saved: "tasks.description.status.saved",
  saving: "tasks.description.status.saving",
};

/** Shows how saving goes and how long the text is near its limit. */
function SaveStatus({
  state,
}: {
  readonly state: TicketDescriptionState;
}): React.ReactElement {
  const { t } = useTranslation();
  const length = state.draft.length;
  const limit = WORK_ITEM_LIMITS.descriptionLength;
  const statusKey =
    STATUS_KEYS[state.status] ??
    (state.isDirty ? "tasks.description.status.unsaved" : null);

  return (
    <p
      aria-live="polite"
      className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
      role="status"
    >
      {state.status === "failed" ? (
        <span className="text-destructive">
          {t("tasks.description.status.failed", {
            reason: t(`tasks.error.${state.errorCode}`, {
              defaultValue: state.errorCode,
            }),
          })}
        </span>
      ) : null}
      {statusKey ? <span>{t(statusKey)}</span> : null}
      {length >= limit * 0.8 ? (
        <span className={cn(length > limit && "text-destructive")}>
          {t("tasks.description.counter", { count: length, max: limit })}
        </span>
      ) : null}
    </p>
  );
}

/** Save and cancel of the description, with the status beside them. */
export function DescriptionActions({
  state,
  isApple,
  canSave = true,
}: {
  readonly state: TicketDescriptionState;
  readonly isApple: boolean;
  readonly canSave?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const saveKeys = formatShortcut("saveDescription", isApple);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SaveStatus state={state} />
      <div className="ml-auto flex items-center gap-2">
        <Button
          className="h-8 px-3 text-xs"
          type="button"
          variant="ghost"
          onClick={state.cancel}
        >
          {t("tasks.description.cancel")}
        </Button>
        <Button
          className="h-8 px-3 text-xs"
          isPending={state.status === "saving"}
          disabled={!canSave}
          title={t("tasks.description.saveHint", { shortcut: saveKeys })}
          type="button"
          onClick={() => state.save()}
        >
          {t("tasks.description.save")}
        </Button>
      </div>
    </div>
  );
}

/** Tells that someone else saved meanwhile and offers both ways out. */
export function DescriptionConflict({
  onTakeLatest,
  onOverwrite,
  canOverwrite = true,
}: {
  readonly onTakeLatest: () => void;
  readonly onOverwrite: () => void;
  readonly canOverwrite?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div
      className="rounded-lg border border-warning bg-warning-subtle p-3 text-sm text-foreground"
      role="alert"
    >
      <p className="font-semibold">{t("tasks.description.conflict.title")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("tasks.description.conflict.body")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          className="h-8 px-3 text-xs"
          type="button"
          variant="outline"
          onClick={onTakeLatest}
        >
          {t("tasks.description.conflict.reload")}
        </Button>
        <Button
          className="h-8 px-3 text-xs"
          type="button"
          onClick={onOverwrite}
          disabled={!canOverwrite}
        >
          {t("tasks.description.conflict.overwrite")}
        </Button>
      </div>
    </div>
  );
}

/** Asks what happens to an unsaved description when the person leaves. */
export function DescriptionLeaveDialog({
  guard,
}: {
  readonly guard: DescriptionLeaveGuard;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Dialog
      open={guard.isAsking}
      // The question only closes by itself (Escape, outside click); that stays.
      onOpenChange={guard.stay}
    >
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("tasks.description.leave.title")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {t("tasks.description.leave.body")}
        </DialogDescription>
        <footer className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={guard.stay}>
            {t("tasks.description.leave.stay")}
          </Button>
          <Button type="button" variant="outline" onClick={guard.discard}>
            {t("tasks.description.leave.discard")}
          </Button>
          <Button type="button" onClick={guard.saveAndLeave}>
            {t("tasks.description.leave.save")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
