import { useTextAssistant } from "@/app/components/assistant/use-text-assistant";
import { WIKI_LIMITS } from "@/definition/Wiki";

import type { BlockEditorHandle } from "@/app/components/editor/block-editor-types";
import type { WikiPage } from "@/definition/Wiki";
import type { WikiDraftState } from "./use-wiki-draft";

/** Waits for wiki autosave before pinning the saved revision of a text request. */
export function useWikiTextAssistant(
  state: WikiDraftState,
  page: WikiPage,
  handle: React.RefObject<BlockEditorHandle | null>,
): ReturnType<typeof useTextAssistant> {
  return useTextAssistant({
    context: {
      kind: "wiki",
      id: page.id,
      version: String(state.saved.revision),
    },
    title: state.draft.title,
    handle,
    content: state.draft.content,
    canEdit: true,
    canSend: state.isClean && state.status === "saved",
    maximumLength: WIKI_LIMITS.contentLength,
  });
}
