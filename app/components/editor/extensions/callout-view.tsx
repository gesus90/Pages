import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { useTranslation } from "react-i18next";

import {
  CALLOUT_STYLES,
  isCalloutKind,
} from "@/app/components/markdown/callout-style";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/cn";
import { WIKI_CALLOUT_KINDS } from "@/app/lib/wiki-remark";

import type { ReactNodeViewProps } from "@tiptap/react";

/** A callout in the editor: its icon, a choice of kind and the blocks inside. */
export function CalloutView({
  editor,
  node,
  updateAttributes,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useTranslation();
  const attribute: unknown = node.attrs.kind;
  const kind = isCalloutKind(attribute) ? attribute : "note";
  const { className, icon: Icon } = CALLOUT_STYLES[kind];

  return (
    <NodeViewWrapper
      className={cn("my-2 flex gap-3 rounded-lg border p-3", className)}
      data-callout={kind}
      role="note"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!editor.isEditable}>
          <button
            aria-label={t("editor.callout.kind", {
              kind: t(`editor.callout.kinds.${kind}`),
            })}
            className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-surface-hover"
            contentEditable={false}
            type="button"
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {WIKI_CALLOUT_KINDS.map((option) => (
            <DropdownMenuItem
              key={option}
              onSelect={() => updateAttributes({ kind: option })}
            >
              {t(`editor.callout.kinds.${option}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <NodeViewContent className="min-w-0 flex-1" />
    </NodeViewWrapper>
  );
}
