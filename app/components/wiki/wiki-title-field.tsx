import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { countCharacters, WIKI_LIMITS } from "@/definition/Wiki";

interface WikiTitleFieldProps {
  readonly value: string;
  readonly onChange: (title: string) => void;
  /** Called on Enter, to continue in the text below the title. */
  readonly onEnter: () => void;
}

/**
 * The title of a page, edited in place as a large heading (Notion-like):
 * one line that wraps, without a visible form frame.
 */
export function WikiTitleField({
  value,
  onChange,
  onEnter,
}: WikiTitleFieldProps): React.ReactElement {
  const { t } = useTranslation();
  const field = useRef<HTMLTextAreaElement | null>(null);

  // Grows with the title; the field is mounted when layout effects run.
  useLayoutEffect(() => {
    const element = field.current as HTMLTextAreaElement;

    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  const length = countCharacters(value);

  return (
    <div>
      <textarea
        ref={field}
        aria-label={t("wiki.editor.titleLabel")}
        className="block w-full resize-none overflow-hidden bg-transparent text-4xl leading-tight font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/60"
        placeholder={t("wiki.editor.titlePlaceholder")}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onEnter();
          }
        }}
      />
      {length >= WIKI_LIMITS.titleLength * 0.8 ? (
        <p
          className={cn(
            "mt-1 text-xs",
            length > WIKI_LIMITS.titleLength
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {length} / {WIKI_LIMITS.titleLength}
        </p>
      ) : null}
    </div>
  );
}
