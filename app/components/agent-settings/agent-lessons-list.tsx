import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { cn } from "@/app/lib/cn";

import { describeDreamFileSize } from "./agent-dreaming-display";
import { DreamBadge, DreamCard } from "./agent-dreaming-widgets";
import { AgentLessonEditor } from "./agent-lesson-editor";
import { AgentRowActions } from "./agent-lessons-actions";
import {
  lessonsPendingKey,
  readPendingRowAction,
  shortenText,
} from "./agent-lessons-display";

import type { AgentLessonsState } from "./use-agent-lessons";
import type {
  AgentLessonView,
  AgentLessonsOverview,
} from "@/definition/AgentDreaming";

/** How many characters of a lesson name it in the label of a button. */
const SUBJECT_CHARACTERS = 50;

interface LessonRowProps {
  readonly lesson: AgentLessonView;
  readonly lessons: AgentLessonsState;
}

/** One lesson with its evidence, date, strength and status, and the buttons to change it. */
function LessonRow({ lesson, lessons }: LessonRowProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDate } = useRegionFormatter();
  const [isEditing, setIsEditing] = useState(false);
  const { pendingKey } = lessons;
  const isBusy = pendingKey !== null;
  const isSaving = pendingKey === lessonsPendingKey("save-lesson", lesson.id);

  async function handleSave(text: string, evidence: string): Promise<void> {
    if (await lessons.saveLesson(lesson.id, text, evidence))
      setIsEditing(false);
  }

  if (isEditing)
    return (
      <li className="rounded-lg border border-border/60 p-3">
        <AgentLessonEditor
          lesson={lesson}
          isBusy={isBusy}
          isSaving={isSaving}
          onSave={(text, evidence) => void handleSave(text, evidence)}
          onCancel={() => setIsEditing(false)}
        />
      </li>
    );
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p
          className={cn(
            "min-w-0 flex-1 text-sm break-words",
            lesson.isActive ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {lesson.text}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <DreamBadge>
            {t("agentLessons.strength", { strength: lesson.strength })}
          </DreamBadge>
          <DreamBadge tone={lesson.isActive ? "success" : "neutral"}>
            {t(
              lesson.isActive
                ? "agentLessons.status.active"
                : "agentLessons.status.off",
            )}
          </DreamBadge>
        </div>
      </div>
      <p className="text-xs break-words text-muted-foreground">
        {t("agentLessons.evidence", { evidence: lesson.evidence })}
        {" · "}
        {t("agentLessons.date", { date: formatDate(lesson.date) })}
      </p>
      <AgentRowActions
        kind="lesson"
        subject={shortenText(lesson.text, SUBJECT_CHARACTERS)}
        isActive={lesson.isActive}
        isBusy={isBusy}
        pendingAction={readPendingRowAction(pendingKey, "lesson", lesson.id)}
        onEdit={() => setIsEditing(true)}
        onToggle={() =>
          void lessons.setLessonActive(lesson.id, !lesson.isActive)
        }
        onRemove={() => void lessons.removeLesson(lesson.id)}
      />
    </li>
  );
}

/**
 * The card "Lektionen": every lesson of `DREAM.md` with its text, evidence,
 * date, strength and status, how much of the file they fill, and the buttons
 * to edit, switch off and delete them.
 */
export function AgentLessonsList({
  overview,
  lessons,
}: {
  readonly overview: AgentLessonsOverview;
  readonly lessons: AgentLessonsState;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  return (
    <DreamCard
      title={t("agentLessons.lessons.title")}
      action={
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("agentLessons.lessons.usage", {
            size: describeDreamFileSize(overview.dream, t, i18n.language),
          })}
        </span>
      }
    >
      <p className="text-xs text-muted-foreground">
        {t("agentLessons.lessons.hint")}
      </p>
      {overview.lessons.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("agentLessons.lessons.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {overview.lessons.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} lessons={lessons} />
          ))}
        </ul>
      )}
    </DreamCard>
  );
}
