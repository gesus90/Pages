import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";

import type { AgentLessonView } from "@/definition/AgentDreaming";

interface AgentLessonEditorProps {
  readonly lesson: AgentLessonView;
  /** Whether a change runs now; the buttons wait for it. */
  readonly isBusy: boolean;
  /** Whether this lesson is the one being saved. */
  readonly isSaving: boolean;
  readonly onSave: (text: string, evidence: string) => void;
  readonly onCancel: () => void;
}

/** The inline editor of one lesson: its text and what it rests on. */
export function AgentLessonEditor({
  lesson,
  isBusy,
  isSaving,
  onSave,
  onCancel,
}: AgentLessonEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(lesson.text);
  const [evidence, setEvidence] = useState(lesson.evidence);
  const hasTextProblem = text.trim() === "";

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!hasTextProblem && !isBusy) onSave(text.trim(), evidence.trim());
  }

  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground" htmlFor={`${id}-text`}>
          {t("agentLessons.lessons.textLabel")}
        </label>
        <Textarea
          aria-invalid={hasTextProblem}
          className="min-h-20"
          id={`${id}-text`}
          onChange={(event) => setText(event.currentTarget.value)}
          value={text}
        />
        {hasTextProblem ? (
          <p className="text-xs text-destructive" role="alert">
            {t("agentLessons.lessons.textInvalid")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label
          className="text-xs text-muted-foreground"
          htmlFor={`${id}-evidence`}
        >
          {t("agentLessons.lessons.evidenceLabel")}
        </label>
        <Input
          id={`${id}-evidence`}
          onChange={(event) => setEvidence(event.currentTarget.value)}
          value={evidence}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={hasTextProblem || isBusy}
          isPending={isSaving}
          size="sm"
          type="submit"
        >
          {t("agentLessons.editor.save")}
        </Button>
        <Button
          disabled={isSaving}
          onClick={onCancel}
          size="sm"
          variant="outline"
        >
          {t("agentLessons.editor.cancel")}
        </Button>
      </div>
    </form>
  );
}
