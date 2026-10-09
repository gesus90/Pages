import { useCallback, useRef, useState } from "react";

import { BlockEditor } from "@/app/components/editor/block-editor";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";
import { isApplePlatform } from "@/app/lib/editor/editor-shortcuts";

import { DescriptionActions, DescriptionConflict } from "./description-parts";

import type {
  BlockEditorFeatures,
  BlockEditorHandle,
} from "@/app/components/editor/block-editor-types";
import type { TicketDescriptionState } from "./use-ticket-description";

interface DescriptionEditorProps {
  readonly state: TicketDescriptionState;
  readonly label: string;
  readonly features: BlockEditorFeatures;
  readonly variant: "page" | "panel";
  readonly canEdit?: boolean;
  readonly assistantHandle?: React.RefObject<BlockEditorHandle | null>;
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
  assistantHandle,
}: DescriptionEditorProps): React.ReactElement {
  const handle = useRef<BlockEditorHandle | null>(null);
  const [isApple] = useState(
    () =>
      typeof navigator !== "undefined" && isApplePlatform(navigator.userAgent),
  );

  // The editor hands its controls out again whenever this callback changes;
  // a new callback per render would put the caret back to the start after
  // every keystroke.
  const handleReady = useCallback(
    (ready: BlockEditorHandle | null): void => {
      handle.current = ready;
      if (assistantHandle) assistantHandle.current = ready;
      ready?.focusStart();
    },
    [assistantHandle],
  );

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
        isEditable={canEdit && state.status !== "saving"}
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
