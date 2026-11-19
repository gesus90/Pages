import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { BlockEditor } from "@/app/components/editor/block-editor";
import { Button } from "@/app/components/ui/button";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";
import {
  formatShortcut,
  isApplePlatform,
} from "@/app/lib/editor/editor-shortcuts";
import { WORK_ITEM_LIMITS } from "@/definition/Task";

import type {
  BlockEditorFeatures,
  BlockEditorHandle,
} from "@/app/components/editor/block-editor-types";
import type { TicketDescriptionState } from "./use-ticket-description";

const STATUS_KEYS: Readonly<Record<string, string>> = {
  saved: "tasks.description.status.saved",
  saving: "tasks.description.status.saving",
};

interface DescriptionEditorProps {
  readonly state: TicketDescriptionState;
  readonly label: string;
  readonly features: BlockEditorFeatures;
  readonly variant: "page" | "panel";
  readonly canEdit?: boolean;
}

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
              defaultValue: t("backgroundSave.error"),
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

function DescriptionActions({
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
          disabled={state.status === "saving"}
          onClick={state.cancel}
        >
          {t("tasks.description.cancel")}
        </Button>
        <Button
          className="h-8 px-3 text-xs"
          isPending={state.status === "saving"}
          disabled={!canSave || !state.isDirty}
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

function DescriptionConflict({
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

/**
 * The block editor of a ticket description with toolbar, save and cancel,
 * and conflict handling; loaded on demand by `TicketDescription`.
 */
export default function DescriptionEditor({
  state,
  label,
  features,
  variant,
  canEdit = true,
}: DescriptionEditorProps): React.ReactElement {
  const handle = useRef<BlockEditorHandle | null>(null);
  const [isApple] = useState(
    () =>
      typeof navigator !== "undefined" && isApplePlatform(navigator.userAgent),
  );

  // The editor hands its controls out again whenever this callback changes;
  // a new callback per render would put the caret back to the start after
  // every keystroke.
  const handleReady = useCallback((ready: BlockEditorHandle | null): void => {
    handle.current = ready;
    ready?.focusStart();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      // Taken before the editor sees it, which would add a line break.
      event.preventDefault();
      event.stopPropagation();
      if (canEdit && state.status !== "saving") state.save();
    }
  }

  return (
    <div className="flex flex-col gap-3" onKeyDownCapture={handleKeyDown}>
      <BlockEditor
        className={cn(
          "rounded-lg border border-border bg-surface px-3 pb-3",
          variant === "page" ? "min-h-[24rem]" : "min-h-48",
        )}
        fallback={<WikiMarkdown source={state.draft} />}
        features={features}
        hasToolbar
        isEditable={canEdit}
        label={label}
        markdown={state.draft}
        onChange={state.change}
        onReady={handleReady}
      />
      {state.status === "conflict" ? (
        <DescriptionConflict
          canOverwrite={canEdit}
          onOverwrite={() => state.save(true)}
          onTakeLatest={() =>
            handle.current?.replaceMarkdown(state.takeLatest())
          }
        />
      ) : null}
      <DescriptionActions canSave={canEdit} isApple={isApple} state={state} />
    </div>
  );
}
