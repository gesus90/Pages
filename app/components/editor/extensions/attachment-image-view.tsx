import { NodeViewWrapper } from "@tiptap/react";
import { ImageOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { readTextAttribute } from "@/app/lib/editor/editor-schema";
import { cn } from "@/app/lib/cn";

import type { ReactNodeViewProps } from "@tiptap/react";

/** An image in the editor, or a placeholder for an address that is not shown. */
export function AttachmentImageView({
  extension,
  node,
  selected,
}: ReactNodeViewProps): React.ReactElement {
  const { t } = useTranslation();
  const src = readTextAttribute(node.attrs, "src") ?? "";
  const alt = readTextAttribute(node.attrs, "alt") ?? "";
  // The image extension always carries its display rule as an option.
  const isShown: boolean = extension.options.isDisplayable(src) === true;

  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        "inline-block max-w-full rounded-lg",
        selected && "ring-2 ring-primary",
      )}
      data-drag-handle=""
    >
      {isShown ? (
        <img
          alt={alt}
          className="max-h-[32rem] max-w-full rounded-lg"
          draggable={false}
          src={src}
        />
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          <ImageOff aria-hidden="true" className="size-3.5" />
          {t("editor.image.hidden", { name: alt === "" ? src : alt })}
        </span>
      )}
    </NodeViewWrapper>
  );
}
