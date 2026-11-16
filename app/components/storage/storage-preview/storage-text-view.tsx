import { useTranslation } from "react-i18next";

import { StoragePreviewScroller } from "./storage-preview-scroller";

/**
 * A text file as monospace text.
 * @remarks
 * Line breaks are kept; long lines and long words wrap, so plain text never
 * scrolls sideways. The text is a text node, never markup: HTML and scripts
 * in the file are shown as characters.
 */
export function StorageTextView({
  text,
  label,
}: {
  readonly text: string;
  readonly label: string;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <StoragePreviewScroller label={label}>
      {text === "" ? (
        <p className="px-5 py-5 text-sm text-muted-foreground md:px-6">
          {t("storage.preview.empty")}
        </p>
      ) : (
        <pre className="max-w-[96ch] px-5 py-5 font-mono text-[15px] leading-[26px] break-words whitespace-pre-wrap text-foreground [overflow-wrap:anywhere] md:px-6 md:text-[13px] md:leading-5">
          {text}
        </pre>
      )}
    </StoragePreviewScroller>
  );
}
