import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import styles from "@/app/components/editor/block-editor.module.css";

import type { ReactNodeViewProps } from "@tiptap/react";

/** A toggle in the editor: the open/close button and its blocks. */
export function ToggleView({
  editor,
  getPos,
  node,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useTranslation();
  const isOpen = node.attrs.open === true;

  function handleToggle(): void {
    const position = getPos();

    if (typeof position !== "number") {
      return;
    }

    // Opening and closing is a view state: it changes no saved text and is
    // no step of undo.
    editor.view.dispatch(
      editor.state.tr
        .setNodeAttribute(position, "open", !isOpen)
        .setMeta("addToHistory", false),
    );
  }

  return (
    <NodeViewWrapper
      className={cn(styles.toggle, "my-1 flex gap-1")}
      data-open={isOpen ? "true" : "false"}
    >
      <button
        aria-expanded={isOpen}
        aria-label={t(isOpen ? "editor.toggle.close" : "editor.toggle.open")}
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-surface-hover"
        contentEditable={false}
        type="button"
        onClick={handleToggle}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn("size-4 transition-transform", isOpen && "rotate-90")}
        />
      </button>
      <NodeViewContent className={cn(styles.toggleContent, "min-w-0 flex-1")} />
    </NodeViewWrapper>
  );
}
