import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { FileCode } from "lucide-react";
import { useTranslation } from "react-i18next";

/** A source block: a label and the markdown as monospaced, editable text. */
export function RawMarkdownView(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <NodeViewWrapper className="my-2 rounded-lg border border-dashed border-border bg-muted/40 p-3">
      <p
        className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"
        contentEditable={false}
      >
        <FileCode aria-hidden="true" className="size-3.5" />
        {t("editor.raw.label")}
      </p>
      <NodeViewContent<"pre">
        as="pre"
        className="font-mono text-xs whitespace-pre-wrap"
        data-raw-markdown=""
      />
    </NodeViewWrapper>
  );
}
