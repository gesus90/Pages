import { useTranslation } from "react-i18next";

import { AgentLessonsList } from "./agent-lessons-list";
import { AgentRecipesList } from "./agent-recipes-list";
import { AgentTabFooter, AgentTabPlaceholder } from "./agent-dreaming-shell";
import { useAgentLessons } from "./use-agent-lessons";

import type { AgentLessonsState } from "./use-agent-lessons";
import type { AgentLessonsOverview } from "@/definition/AgentDreaming";

interface LessonsContentProps {
  readonly overview: AgentLessonsOverview;
  readonly lessons: AgentLessonsState;
  readonly onClose: () => void;
}

/** The two lists and the footer of an agent whose lessons and recipes were read. */
function LessonsContent({
  overview,
  lessons,
  onClose,
}: LessonsContentProps): React.ReactElement {
  const { t } = useTranslation();
  const { failure } = lessons;
  return (
    <>
      <div className="flex flex-col gap-4 px-6 py-5">
        {overview.canChange ? (
          <>
            <AgentLessonsList overview={overview} lessons={lessons} />
            <AgentRecipesList overview={overview} lessons={lessons} />
          </>
        ) : (
          <p
            className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground"
            role="note"
          >
            {t("agentLessons.readOnly")}
          </p>
        )}
      </div>
      <AgentTabFooter
        closeLabel={t("agentLessons.close")}
        notice={
          failure === null ? undefined : (
            <p className="text-sm text-destructive" role="alert">
              {t(`agentLessons.failure.${failure}`)}
            </p>
          )
        }
        onClose={onClose}
      />
    </>
  );
}

/**
 * The tab "Lektionen & Rezepte" of the agent settings (PAGE-378): the lessons
 * of `DREAM.md` and the recipes of the agent, each to read, edit, switch off
 * and delete. Only administrators see and change them.
 *
 * @remarks
 * The lists are read when the tab opens. After every change the tab shows the
 * overview the server answers with.
 *
 * @param props - The agent whose lessons and recipes the tab shows, and the
 * callback that closes the popup.
 * @returns The tab content or its loading and failure placeholder.
 */
export function AgentLessonsTab({
  agentId,
  onClose,
}: {
  readonly agentId: string;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const lessons = useAgentLessons(agentId);
  const { overview, loadFailure } = lessons;
  if (overview === null)
    return (
      <AgentTabPlaceholder
        loadingText={t("agentLessons.loading")}
        failureText={
          loadFailure === null ? null : t(`agentLessons.failure.${loadFailure}`)
        }
        retryLabel={t("agentLessons.retry")}
        closeLabel={t("agentLessons.close")}
        onRetry={lessons.reload}
        onClose={onClose}
      />
    );
  return (
    <LessonsContent overview={overview} lessons={lessons} onClose={onClose} />
  );
}
