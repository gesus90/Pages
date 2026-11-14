import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import {
  draftForNew,
  draftFromEntry,
  fieldsOfDraft,
  patchOfDraft,
} from "./calendar-event-draft";
import { CalendarEventFields } from "./calendar-event-fields";
import { useCalendarMutation } from "./use-calendar-mutation";

import type {
  CalendarScope,
  CalendarTarget,
  CalendarViewEntry,
} from "@/definition/Calendar";
import type { CalendarDraftStart } from "./calendar-context";
import type { EventDraft, EventDraftProblem } from "./calendar-event-draft";

/** What the form opens for: a new event or a change with its scope. */
export type EventFormRequest =
  | { readonly mode: "create"; readonly start: CalendarDraftStart }
  | {
      readonly mode: "edit";
      readonly entry: CalendarViewEntry;
      readonly scope: CalendarScope;
    };

interface CalendarEventFormDialogProps {
  readonly request: EventFormRequest | null;
  readonly targets: readonly CalendarTarget[];
  readonly timeZone: string;
  readonly onClose: () => void;
}

interface EventFormProps {
  readonly request: EventFormRequest;
  readonly targets: readonly CalendarTarget[];
  readonly timeZone: string;
  readonly onClose: () => void;
}

function initialDraft(request: EventFormRequest): EventDraft {
  return request.mode === "create"
    ? draftForNew(request.start)
    : draftFromEntry(request.entry);
}

/** The form; it lives only while the dialog is open. */
function EventForm({
  request,
  targets,
  timeZone,
  onClose,
}: EventFormProps): React.ReactElement {
  const { t } = useTranslation();
  const [initial] = useState(() => initialDraft(request));
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState<EventDraftProblem | null>(null);
  const mutation = useCalendarMutation(onClose);
  const canRepeat = request.mode === "create" || request.scope !== "this";

  function handleChange(change: Partial<EventDraft>): void {
    setDraft((current) => ({ ...current, ...change }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = fieldsOfDraft(draft, timeZone);
    setProblem(result.ok ? null : result.problem);
    if (!result.ok) return;
    if (request.mode === "create") {
      mutation.submit("create", { fields: JSON.stringify(result.fields) });
      return;
    }
    const patch = patchOfDraft(result.fields, draft, initial, request.scope);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    mutation.submit("update", {
      id: request.entry.id,
      scope: request.scope,
      occurrenceStart: request.entry.occurrenceStart ?? "",
      patch: JSON.stringify(patch),
    });
  }

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={handleSubmit}
      noValidate
    >
      <CalendarEventFields
        draft={draft}
        targets={targets}
        canRepeat={canRepeat}
        onChange={handleChange}
      />
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`calendar.form.errors.${problem}`)}
        </p>
      ) : null}
      {mutation.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`calendar.errors.${mutation.error}`)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button variant="outline">{t("calendar.cancel")}</Button>
        </DialogClose>
        <Button type="submit" isPending={mutation.isPending}>
          {t("calendar.form.save")}
        </Button>
      </div>
    </form>
  );
}

/** „Neuer Termin“ and „Termin bearbeiten“. */
export function CalendarEventFormDialog({
  request,
  targets,
  timeZone,
  onClose,
}: CalendarEventFormDialogProps): React.ReactElement {
  const { t } = useTranslation();

  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) onClose();
  }

  return (
    <Dialog open={request !== null} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <div className="flex items-center justify-between gap-2">
          <DialogTitle className="text-lg font-semibold text-foreground">
            {t(
              request?.mode === "edit"
                ? "calendar.form.editTitle"
                : "calendar.form.newTitle",
            )}
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
        <DialogDescription className="sr-only">
          {t("calendar.form.hint")}
        </DialogDescription>
        {request ? (
          <EventForm
            request={request}
            targets={targets}
            timeZone={timeZone}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
