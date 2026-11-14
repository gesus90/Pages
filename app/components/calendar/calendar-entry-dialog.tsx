import { ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";

import { useCalendarContext } from "./calendar-context";
import { CalendarEntryFacts } from "./calendar-entry-facts";
import { CalendarScopeChoice } from "./calendar-scope-choice";
import { useCalendarMutation } from "./use-calendar-mutation";

import type {
  CalendarAnswer,
  CalendarScope,
  CalendarViewEntry,
} from "@/definition/Calendar";

interface CalendarEntryDialogProps {
  readonly entry: CalendarViewEntry | null;
  readonly onClose: () => void;
  readonly onEdit: (entry: CalendarViewEntry, scope: CalendarScope) => void;
}

interface EntryPanelProps {
  readonly entry: CalendarViewEntry;
  readonly onClose: () => void;
  readonly onEdit: (entry: CalendarViewEntry, scope: CalendarScope) => void;
}

type PendingChoice = "edit" | "delete" | null;

const ANSWERS: readonly CalendarAnswer[] = ["accepted", "declined"];

/** „Deine Antwort: Zusagen / Absagen“ for an invited person. */
function ResponseChoice({
  entry,
}: {
  readonly entry: CalendarViewEntry;
}): React.ReactElement {
  const { t } = useTranslation();
  const mutation = useCalendarMutation();

  function handleAnswer(answer: CalendarAnswer): void {
    mutation.submit("respond", { id: entry.id, answer });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">
        {t("calendar.detail.yourAnswer")}
      </span>
      <div
        className="inline-flex rounded-lg border border-border p-0.5"
        role="group"
      >
        {ANSWERS.map((answer) => (
          <button
            key={answer}
            type="button"
            aria-pressed={entry.myResponse === answer}
            disabled={mutation.isPending}
            className={cn(
              "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground",
              entry.myResponse === answer &&
                "bg-primary-subtle font-medium text-foreground",
            )}
            onClick={() => handleAnswer(answer)}
          >
            {t(`calendar.detail.answer.${answer}`)}
          </button>
        ))}
      </div>
      {mutation.error ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {t(`calendar.errors.${mutation.error}`)}
        </p>
      ) : null}
    </div>
  );
}

/** Bearbeiten and Löschen, with the scope choice of a series and a confirmation. */
function EntryActions({
  entry,
  onClose,
  onEdit,
}: EntryPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<PendingChoice>(null);
  const mutation = useCalendarMutation(onClose);
  const isSeries = entry.seriesId !== null;

  function remove(scope: CalendarScope): void {
    mutation.submit("delete", {
      id: entry.id,
      scope,
      occurrenceStart: entry.occurrenceStart ?? "",
    });
  }

  function handleChoose(scope: CalendarScope): void {
    if (choice === "edit") onEdit(entry, scope);
    else remove(scope);
  }

  if (choice !== null && isSeries)
    return (
      <CalendarScopeChoice
        action={choice}
        isPending={mutation.isPending}
        onChoose={handleChoose}
        onCancel={() => setChoice(null)}
      />
    );
  if (choice === "delete")
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-sm text-foreground">
          {t("calendar.detail.confirmDelete")}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setChoice(null)}>
          {t("calendar.cancel")}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          isPending={mutation.isPending}
          onClick={() => remove("all")}
        >
          {t("calendar.detail.delete")}
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => (isSeries ? setChoice("edit") : onEdit(entry, "all"))}
        >
          {t("calendar.detail.edit")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setChoice("delete")}>
          {t("calendar.detail.delete")}
        </Button>
      </div>
      {mutation.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`calendar.errors.${mutation.error}`)}
        </p>
      ) : null}
    </div>
  );
}

/** The footer: a link to the source of a deadline, or the actions of an editable event. */
function EntryFooter({
  entry,
  onClose,
  onEdit,
}: EntryPanelProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (entry.details.link !== null)
    return (
      <Link
        to={entry.details.link}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary hover:underline"
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        {t(`calendar.detail.source.${entry.source.kind}`)}
      </Link>
    );
  return entry.editable ? (
    <EntryActions entry={entry} onClose={onClose} onEdit={onEdit} />
  ) : null;
}

function EntryPanel({
  entry,
  onClose,
  onEdit,
}: EntryPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const { colorOf } = useCalendarContext();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "mt-1.5 size-3 shrink-0 rounded-sm",
            colorOf(entry).dot,
          )}
        />
        <DialogTitle className="flex-1 text-lg font-semibold text-foreground">
          {entry.title}
        </DialogTitle>
        <DialogClose asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("calendar.close")}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </DialogClose>
      </div>
      <DialogDescription asChild>
        <div>
          <CalendarEntryFacts entry={entry} />
        </div>
      </DialogDescription>
      {entry.myResponse !== null && !entry.details.createdByMe ? (
        <ResponseChoice entry={entry} />
      ) : null}
      <EntryFooter entry={entry} onClose={onClose} onEdit={onEdit} />
    </div>
  );
}

/**
 * The detail of an entry: its facts, the answer of an invited person and
 * the actions of an editable event or the link to the source of a deadline.
 */
export function CalendarEntryDialog({
  entry,
  onClose,
  onEdit,
}: CalendarEntryDialogProps): React.ReactElement {
  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) onClose();
  }

  return (
    <Dialog open={entry !== null} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        {entry ? (
          <EntryPanel
            key={entry.id}
            entry={entry}
            onClose={onClose}
            onEdit={onEdit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
