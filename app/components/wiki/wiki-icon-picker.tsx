import { SmilePlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

/** Emoji offered as page icons. */
const ICONS = [
  "📘",
  "📝",
  "📌",
  "💡",
  "🧭",
  "🛠️",
  "🐞",
  "🚀",
  "📊",
  "📅",
  "✅",
  "⚠️",
  "🔒",
  "🎯",
  "📚",
  "🧪",
  "🗂️",
  "🔧",
  "💬",
  "⭐",
  "🏁",
  "🧩",
  "📦",
  "🌍",
] as const;

interface WikiIconPickerProps {
  readonly value: string;
  readonly onChange: (icon: string) => void;
}

/** A button that shows the page icon and offers a choice of emoji. */
export function WikiIconPicker({
  value,
  onChange,
}: WikiIconPickerProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("wiki.editor.icon")}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-2xl hover:bg-surface-hover"
          type="button"
        >
          {value === "" ? (
            <SmilePlus
              aria-hidden="true"
              className="size-5 text-muted-foreground"
            />
          ) : (
            value
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="grid w-56 grid-cols-6 gap-1 p-2"
      >
        {ICONS.map((icon) => (
          <DropdownMenuItem
            key={icon}
            className="justify-center text-lg"
            onSelect={() => onChange(icon)}
          >
            {icon}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          className="col-span-6 justify-center text-xs"
          onSelect={() => onChange("")}
        >
          {t("wiki.editor.removeIcon")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
