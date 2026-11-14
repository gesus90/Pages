import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import {
  describeDreamFileSize,
  dreamFilePercent,
} from "./agent-dreaming-display";
import { DreamCard } from "./agent-dreaming-widgets";

import type {
  AgentDreamFileSize,
  AgentDreamingOverview,
} from "@/definition/AgentDreaming";

/** The share of the limit a file uses above which its bar warns. */
const CROWDED_PERCENT = 90;

interface FileRowProps {
  readonly name: string;
  readonly size: AgentDreamFileSize;
  /** What else to say about the file, such as how many lessons it holds. */
  readonly note?: string;
  /** The text of the file; `null` for a viewer who may not read it. */
  readonly text: string | null;
}

/** One file of the memory: its size against the limit, a bar and, when readable, its text. */
function FileRow({ name, size, note, text }: FileRowProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const percent = dreamFilePercent(size);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-sm font-medium text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {describeDreamFileSize(size, t, i18n.language)}
          {note === undefined ? "" : ` · ${note}`}
        </p>
      </div>
      <div
        aria-label={t("agentDreaming.files.meter", { name })}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        aria-valuetext={`${String(percent)} %`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
      >
        <div
          className={cn(
            "h-full rounded-full",
            percent >= CROWDED_PERCENT ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      {text === null ? null : (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-primary-text">
            {t("agentDreaming.files.show", { name })}
          </summary>
          {text === "" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("agentDreaming.files.empty")}
            </p>
          ) : (
            <pre
              aria-label={t("agentDreaming.files.content", { name })}
              className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs break-words whitespace-pre-wrap text-foreground"
              tabIndex={0}
            >
              {text}
            </pre>
          )}
        </details>
      )}
    </div>
  );
}

/**
 * The card "Dateien": `MEMORY.md` and `DREAM.md` with their sizes and, for a
 * viewer who may read them, their text. They are edited under Einstellungen →
 * Agents → Gedächtnis; the lessons of `DREAM.md` also in the tab "Lektionen &
 * Rezepte".
 */
export function AgentDreamingFiles({
  overview,
  onOpenLessons,
}: {
  readonly overview: AgentDreamingOverview;
  readonly onOpenLessons: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { files } = overview;
  return (
    <DreamCard
      title={t("agentDreaming.cards.files")}
      action={
        <Button onClick={onOpenLessons} size="sm" variant="outline">
          {t("agentDreaming.files.editLessons")}
        </Button>
      }
    >
      <FileRow
        name="MEMORY.md"
        size={overview.memory}
        text={files?.memory ?? null}
      />
      <FileRow
        name="DREAM.md"
        size={overview.dream}
        note={t("agentDreaming.files.lessons", {
          count: overview.dream.lessons,
        })}
        text={files?.dream ?? null}
      />
      <p className="text-xs text-muted-foreground">
        {t("agentDreaming.files.hint")}
      </p>
    </DreamCard>
  );
}
