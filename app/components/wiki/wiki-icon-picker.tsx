import { SmilePlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { EmojiPicker } from "@/app/components/editor/emoji-picker";
import { FloatingPanel } from "@/app/components/editor/menus/floating-panel";
import { cn } from "@/app/lib/cn";

interface WikiIconPickerProps {
  /** The emoji of the page; empty for none. */
  readonly value: string;
  readonly onChange: (icon: string) => void;
  /** Large icon of the page head, or the small button to add one (no icon yet). */
  readonly variant?: "page" | "add";
}

/**
 * Chooses the emoji of a page: the large icon of the page head (Notion-like)
 * or a quiet "add icon" button, both opening the searchable emoji picker.
 */
export function WikiIconPicker({
  value,
  onChange,
  variant = "page",
}: WikiIconPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  function handlePick(icon: string): void {
    setAnchor(null);
    onChange(icon);
  }

  return (
    <>
      <button
        aria-label={
          variant === "add" ? t("wiki.editor.addIcon") : t("wiki.editor.icon")
        }
        className={cn(
          "flex items-center rounded-xl hover:bg-surface-hover",
          variant === "page"
            ? "size-20 justify-center text-6xl"
            : "h-8 gap-1.5 px-2 text-sm text-muted-foreground",
        )}
        type="button"
        onClick={(event) =>
          setAnchor(event.currentTarget.getBoundingClientRect())
        }
      >
        {variant === "page" ? (
          value
        ) : (
          <>
            <SmilePlus aria-hidden="true" className="size-4" />
            {t("wiki.editor.addIcon")}
          </>
        )}
      </button>
      <FloatingPanel
        anchor={anchor}
        label={t("wiki.editor.icon")}
        onClose={() => setAnchor(null)}
      >
        <EmojiPicker
          onPick={handlePick}
          onRemove={value === "" ? undefined : () => handlePick("")}
        />
      </FloatingPanel>
    </>
  );
}
