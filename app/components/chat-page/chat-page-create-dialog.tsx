import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

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
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";

import type { ReactNode } from "react";
import type {
  VirtualChatDirectory,
  VirtualParticipantReasoning,
} from "@/definition/VirtualChat";

const REASONING_LEVELS: readonly VirtualParticipantReasoning[] = [
  "low",
  "medium",
  "high",
];

const LABEL_CLASS_NAME =
  "block select-none text-sm font-medium text-foreground";

function TextField({
  label,
  isMultiline = false,
}: {
  readonly label: string;
  readonly isMultiline?: boolean;
}): React.ReactElement {
  const id = useId();
  return (
    <div>
      <label className={LABEL_CLASS_NAME} htmlFor={id}>
        {label}
      </label>
      {isMultiline ? (
        <Textarea className="mt-1" id={id} rows={3} />
      ) : (
        <Input className="mt-1" id={id} />
      )}
    </div>
  );
}

function ChoiceField({
  label,
  choices,
}: {
  readonly label: string;
  readonly choices: readonly string[];
}): React.ReactElement {
  return (
    <fieldset>
      <legend className={LABEL_CLASS_NAME}>{label}</legend>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {choices.map((choice) => (
          <label
            key={choice}
            className="inline-flex items-center gap-2 text-sm text-foreground"
          >
            <Checkbox />
            {choice}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ParticipantFields({
  directory,
}: {
  readonly directory: VirtualChatDirectory;
}): React.ReactElement {
  const { t } = useTranslation();
  const modelId = useId();
  const reasoningId = useId();
  const [model, setModel] = useState(directory.modelChoices[0] ?? "");
  const [reasoning, setReasoning] =
    useState<VirtualParticipantReasoning>("medium");
  return (
    <>
      <TextField label={t("chatPage.fields.name")} />
      <TextField label={t("chatPage.fields.role")} />
      <TextField label={t("chatPage.fields.task")} isMultiline />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLASS_NAME} htmlFor={modelId}>
            {t("chatPage.fields.model")}
          </label>
          <Select
            className="mt-1 w-full"
            id={modelId}
            onValueChange={setModel}
            options={directory.modelChoices.map((choice) => ({
              value: choice,
              label: choice,
            }))}
            size="default"
            value={model}
          />
        </div>
        <div>
          <label className={LABEL_CLASS_NAME} htmlFor={reasoningId}>
            {t("chatPage.fields.reasoning")}
          </label>
          <Select
            className="mt-1 w-full"
            id={reasoningId}
            onValueChange={setReasoning}
            options={REASONING_LEVELS.map((level) => ({
              value: level,
              label: t(`chatPage.reasoning.${level}`),
            }))}
            size="default"
            value={reasoning}
          />
        </div>
      </div>
      <ChoiceField
        label={t("chatPage.fields.tools")}
        choices={directory.toolChoices}
      />
    </>
  );
}

function GroupFields({
  directory,
}: {
  readonly directory: VirtualChatDirectory;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <TextField label={t("chatPage.fields.name")} />
      <TextField label={t("chatPage.fields.description")} isMultiline />
      <ChoiceField
        label={t("chatPage.fields.members")}
        choices={directory.participants.map((participant) => participant.name)}
      />
    </>
  );
}

function DialogActions(): React.ReactElement {
  const { t } = useTranslation();
  const hintId = useId();
  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
      <p className="mr-auto text-sm text-muted-foreground" id={hintId}>
        {t("chatPage.comingSoon")}
      </p>
      <DialogClose asChild>
        <Button variant="ghost">{t("chatPage.cancel")}</Button>
      </DialogClose>
      <Button aria-describedby={hintId} disabled type="submit">
        {t("chatPage.create")}
      </Button>
    </div>
  );
}

interface ChatPageCreateDialogProps {
  /** The dialog to show, or `null` while both are closed. */
  readonly kind: "group" | "participant" | null;
  readonly directory: VirtualChatDirectory;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/**
 * The dialog behind a dashed placeholder with the fields of the later
 * creation: participant or group.
 *
 * @remarks
 * PAGE-254 stores nothing: "Erstellen" stays disabled with the hint that it
 * comes soon, and submitting the form does nothing.
 */
export function ChatPageCreateDialog({
  kind,
  directory,
  onOpenChange,
}: ChatPageCreateDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const isGroup = kind === "group";
  let fields: ReactNode = null;
  if (kind === "group") fields = <GroupFields directory={directory} />;
  if (kind === "participant")
    fields = <ParticipantFields directory={directory} />;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={kind !== null}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {isGroup
            ? t("chatPage.groupDialog.title")
            : t("chatPage.participantDialog.title")}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {isGroup
            ? t("chatPage.groupDialog.description")
            : t("chatPage.participantDialog.description")}
        </DialogDescription>
        <form className="mt-5 flex flex-col gap-4" onSubmit={handleSubmit}>
          {fields}
          <DialogActions />
        </form>
      </DialogContent>
    </Dialog>
  );
}
