import { useTranslation } from "react-i18next";

import { useHexDraft } from "@/app/components/tasks/hexagon-color-picker/use-hex-draft";
import { cn } from "@/app/lib/cn";

interface HexColorFieldProps {
  readonly color: string;
  readonly onChange: (color: string) => void;
}

/** Renders the color swatch and the editable HEX value. */
export function HexColorField({
  color,
  onChange,
}: HexColorFieldProps): React.ReactElement {
  const { t } = useTranslation();
  const { changeHexDraft, hexDraft, isHexValid } = useHexDraft(color, onChange);

  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="size-6 shrink-0 rounded-full border border-black/10 shadow-xs"
        style={{ backgroundColor: color }}
      />
      <label
        className="shrink-0 text-xs font-medium text-muted-foreground"
        htmlFor="label-hex-input"
      >
        {t("tasks.labels.hex")}
      </label>
      <input
        id="label-hex-input"
        autoComplete="off"
        className={cn(
          "h-9 min-w-0 flex-1 rounded-lg bg-muted/60 px-2.5 font-mono text-xs tracking-wide text-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-primary",
          !isHexValid && "ring-2 ring-destructive/60",
        )}
        maxLength={7}
        onChange={(event) => changeHexDraft(event.target.value)}
        spellCheck={false}
        value={hexDraft}
      />
    </div>
  );
}
