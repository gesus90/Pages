import { cn } from "@/app/lib/cn";

import { ToolMark } from "../model-picker/tool-mark";

import { useCompactName } from "./use-compact-name";

/** The outline of each vendor tile; static, so Tailwind finds the classes. */
const MARK_BORDERS: Readonly<Record<string, string>> = {
  claude: "border-claude",
  openai: "border-chatgpt",
  antigravity: "border-antigravity",
};

/**
 * The "GPT-" every OpenAI catalog name starts with. The compact badge drops
 * it, because the end that tells the models apart would be cut otherwise.
 */
const OPENAI_NAME_PREFIX = /^GPT-(?=\S)/u;

/**
 * The family word an Antigravity catalog name may start with: `Gemini`,
 * `Claude` or `GPT-`. Antigravity offers models of several families, so
 * only a name that does not fit drops it; any other name is kept whole.
 */
const ANTIGRAVITY_FAMILY_PREFIX = /^(?:(?:Gemini|Claude)\s+|GPT-)(?=\S)/u;

interface ModelChoiceBadgeProps {
  /** The mark key of the model's tool, such as `claude` or `openai`. */
  readonly mark: string;
  /** The model's short catalog name, such as `Sonnet 5.5`. */
  readonly name: string;
  readonly className?: string;
}

/** The name the compact badge starts with: an OpenAI name without its leading "GPT-". */
function fullName(mark: string, name: string): string {
  if (mark !== "openai") return name;
  return name.replace(OPENAI_NAME_PREFIX, "");
}

/** The name the compact badge falls back to when the full one does not fit. */
function shortName(mark: string, name: string): string {
  if (mark !== "antigravity") return fullName(mark, name);
  return name.replace(ANTIGRAVITY_FAMILY_PREFIX, "");
}

/**
 * The chosen model inside a model field: the tool's tile and the short
 * catalog name.
 * @remarks
 * It has the measures of the model badge (24 px high, 1 px solid border,
 * 7 px radius, an 18 px tile with a 5 px radius 2 px from the edge) with the
 * compact 8 px on the right and without the vendor, because a field names
 * only the choice. Claude is outlined in Claude's orange, OpenAI in the green
 * of the ChatGPT tile, Antigravity in its blue, every other tool in the
 * neutral border. An OpenAI name drops its leading "GPT-", such as
 * `6.2 Astra`. An Antigravity name that does not fit drops its family word,
 * such as `4 Argon` for `Gemini 4 Argon` or `Sonnet 5.5` for
 * `Claude Sonnet 5.5`. A name still too long is cut with an ellipsis. The
 * full name stays in the tooltip and for screen readers.
 */
export function ModelChoiceBadge({
  mark,
  name,
  className,
}: ModelChoiceBadgeProps): React.ReactElement {
  const { ref, shown } = useCompactName(
    fullName(mark, name),
    shortName(mark, name),
  );
  return (
    <span
      title={name}
      data-model-badge={mark}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 items-center gap-[7px] rounded-[7px] border bg-surface py-[2px] pr-2 pl-[2px] text-[11px] leading-none",
        MARK_BORDERS[mark] ?? "border-border",
        className,
      )}
    >
      <ToolMark mark={mark} className="size-[18px] rounded-[5px]" />
      <span className="sr-only">{name}</span>
      <span
        ref={ref}
        aria-hidden="true"
        className="min-w-0 truncate font-semibold text-foreground"
      >
        {shown}
      </span>
    </span>
  );
}
