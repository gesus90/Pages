import { NodeViewWrapper, useEditorState } from "@tiptap/react";
import { ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  EDITOR_NODE,
  readNumberAttribute,
} from "@/app/lib/editor/editor-schema";
import { cn } from "@/app/lib/cn";

import type { Editor } from "@tiptap/core";
import type { ReactNodeViewProps } from "@tiptap/react";

interface ContentsEntry {
  readonly level: number;
  readonly text: string;
}

function listHeadings(editor: Editor): ContentsEntry[] {
  const entries: ContentsEntry[] = [];

  editor.state.doc.descendants((node) => {
    if (
      node.type.name === EDITOR_NODE.heading &&
      node.textContent.trim() !== ""
    ) {
      entries.push({
        level: readNumberAttribute(node.attrs, "level", 1),
        text: node.textContent,
      });
    }

    return node.type.name !== EDITOR_NODE.heading;
  });

  return entries;
}

/** The table of contents in the editor, following the headings as they change. */
export function ContentsView({
  editor,
  selected,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useTranslation();
  const headings = useEditorState<readonly ContentsEntry[]>({
    editor,
    equalityFn: (previous, next) =>
      JSON.stringify(previous) === JSON.stringify(next),
    selector: ({ editor: current }) => listHeadings(current),
  });

  return (
    <NodeViewWrapper
      aria-label={t("editor.contents.label")}
      as="nav"
      className={cn(
        "my-3 rounded-lg border border-border bg-muted/40 p-3 text-sm",
        selected && "ring-2 ring-primary",
      )}
      contentEditable={false}
    >
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ListTree aria-hidden="true" className="size-3.5" />
        {t("editor.contents.label")}
      </p>
      {headings.length === 0 ? (
        <p className="text-muted-foreground">{t("editor.contents.empty")}</p>
      ) : (
        <ul className="space-y-1">
          {headings.map((heading, index) => (
            <li
              key={`${index}-${heading.text}`}
              style={{ paddingLeft: `${(heading.level - 1) * 1}rem` }}
            >
              {heading.text}
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  );
}
