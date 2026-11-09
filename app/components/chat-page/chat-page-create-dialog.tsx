import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import {
  VIRTUAL_GROUP_DESCRIPTION_LENGTH,
  VIRTUAL_GROUP_NAME_LENGTH,
} from "@/definition/VirtualChat";

import { ParticipantAvatar } from "./chat-page-avatar";

import type { VirtualParticipant } from "@/definition/VirtualChat";

const LABEL_CLASS_NAME =
  "block select-none text-sm font-medium text-foreground";

/** Why the dialog cannot save, as the interface translates it. */
type GroupFormProblem = "nameMissing" | "membersMissing" | "failed";

interface CreateResult {
  readonly ok: boolean;
  readonly groupId?: string;
}

function isCreateResult(value: unknown): value is CreateResult {
  return typeof value === "object" && value !== null && "ok" in value;
}

function formProblem(
  name: string,
  checked: ReadonlySet<string>,
): GroupFormProblem | null {
  if (name.trim() === "") return "nameMissing";
  if (checked.size === 0) return "membersMissing";
  return null;
}

function MemberField({
  participants,
  checked,
  onToggle,
}: {
  readonly participants: readonly VirtualParticipant[];
  readonly checked: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <fieldset>
      <legend className={LABEL_CLASS_NAME}>
        {t("chatPage.fields.members")}
      </legend>
      {participants.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("chatPage.groupDialog.noParticipants")}
        </p>
      ) : null}
      <ul className="mt-2 flex max-h-56 flex-col overflow-y-auto">
        {participants.map((participant) => (
          <li key={participant.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-muted">
              <Checkbox
                checked={checked.has(participant.id)}
                onChange={() => onToggle(participant.id)}
              />
              <ParticipantAvatar participant={participant} size={26} />
              <span className="truncate">{participant.name}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * The fields of a new group and how they are saved; the dialog mounts them
 * anew at every opening, so each opening starts empty.
 */
function useGroupForm(onCreated: (groupId: string) => void): {
  readonly name: string;
  readonly setName: (name: string) => void;
  readonly description: string;
  readonly setDescription: (description: string) => void;
  readonly checked: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
  readonly submit: () => void;
  readonly problem: GroupFormProblem | null;
  readonly isSaving: boolean;
} {
  const fetcher = useFetcher();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [localProblem, setLocalProblem] = useState<GroupFormProblem | null>(
    null,
  );
  const handled = useRef<unknown>(null);
  const result: unknown = fetcher.data;
  const isIdle = fetcher.state === "idle";

  useEffect(() => {
    if (!isIdle || !isCreateResult(result) || handled.current === result)
      return;
    handled.current = result;
    if (result.ok && result.groupId !== undefined) onCreated(result.groupId);
  }, [isIdle, result, onCreated]);

  function toggle(id: string): void {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(): void {
    const problem = formProblem(name, checked);
    setLocalProblem(problem);
    if (problem) return;
    const formData = new FormData();
    formData.set("intent", "create-group");
    formData.set("name", name.trim());
    formData.set("description", description.trim());
    formData.set("memberIds", JSON.stringify([...checked]));
    void fetcher.submit(formData, { method: "post" });
  }

  const hasFailed = isIdle && isCreateResult(result) && !result.ok;
  return {
    name,
    setName,
    description,
    setDescription,
    checked,
    toggle,
    submit,
    problem: localProblem ?? (hasFailed ? "failed" : null),
    isSaving: !isIdle,
  };
}

/** The form of the dialog; it lives only while the dialog is open. */
function GroupForm({
  participants,
  onCreated,
}: {
  readonly participants: readonly VirtualParticipant[];
  readonly onCreated: (groupId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const form = useGroupForm(onCreated);
  const nameId = useId();
  const descriptionId = useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    form.submit();
  }

  return (
    <form className="mt-5 flex flex-col gap-4" onSubmit={handleSubmit}>
      <div>
        <label className={LABEL_CLASS_NAME} htmlFor={nameId}>
          {t("chatPage.fields.name")}
        </label>
        <Input
          className="mt-1"
          id={nameId}
          maxLength={VIRTUAL_GROUP_NAME_LENGTH}
          onChange={(event) => form.setName(event.target.value)}
          required
          value={form.name}
        />
      </div>
      <div>
        <label className={LABEL_CLASS_NAME} htmlFor={descriptionId}>
          {t("chatPage.fields.description")}
        </label>
        <Textarea
          className="mt-1"
          id={descriptionId}
          maxLength={VIRTUAL_GROUP_DESCRIPTION_LENGTH}
          onChange={(event) => form.setDescription(event.target.value)}
          rows={3}
          value={form.description}
        />
      </div>
      <MemberField
        participants={participants}
        checked={form.checked}
        onToggle={form.toggle}
      />
      {form.problem ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`chatPage.groupDialog.problem.${form.problem}`)}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">{t("chatPage.cancel")}</Button>
        </DialogClose>
        <Button isPending={form.isSaving} type="submit">
          {t("chatPage.create")}
        </Button>
      </div>
    </form>
  );
}

interface ChatPageCreateDialogProps {
  readonly isOpen: boolean;
  /** The person's own participants, which a group can take. */
  readonly participants: readonly VirtualParticipant[];
  readonly onOpenChange: (isOpen: boolean) => void;
  /** Receives the ID of the stored group. */
  readonly onCreated: (groupId: string) => void;
}

/**
 * The dialog "Neue Gruppe" (PAGE-259): name, description and at least one
 * participant of the person's own list, stored for the person.
 *
 * @remarks
 * The server checks the input again. A failure stays in the dialog with the
 * entered values. Participants are never created here (PAGE-266).
 */
export function ChatPageCreateDialog({
  isOpen,
  participants,
  onOpenChange,
  onCreated,
}: ChatPageCreateDialogProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("chatPage.groupDialog.title")}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("chatPage.groupDialog.description")}
        </DialogDescription>
        <GroupForm participants={participants} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  );
}
