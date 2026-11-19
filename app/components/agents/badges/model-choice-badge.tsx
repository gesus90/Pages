import { Tooltip } from "@/app/components/ui/tooltip";
import { cn } from "@/app/lib/cn";

import { ToolMark } from "../model-picker/tool-mark";

/** The outline and the vendor of a tool that has a brand of its own. */
interface MarkStyle {
  /** The outline in the color of the tile; static, so Tailwind finds the class. */
  readonly borderClass: string;
  /** The vendor's or tool's brand name, never translated. */
  readonly vendor: string;
  /** Whether the model ID stands beside the catalog name in the tooltip and the accessible name. */
  readonly isIdNamed?: boolean;
}

const MARK_STYLES: Readonly<Record<string, MarkStyle>> = {
  claude: { borderClass: "border-claude", vendor: "Anthropic" },
  openai: { borderClass: "border-chatgpt", vendor: "OpenAI" },
  antigravity: { borderClass: "border-antigravity", vendor: "Antigravity" },
  opencode: { borderClass: "border-opencode", vendor: "OpenCode" },
  openrouter: { borderClass: "border-openrouter", vendor: "OpenRouter" },
  zai: { borderClass: "border-zai", vendor: "Z.AI", isIdNamed: true },
};

/**
 * The white rim of a tile whose mark is no tile of its own, scaled to the
 * 28 px tile; static, so Tailwind finds the class.
 */
const TILE_RIM_CLASSES: Readonly<Record<string, string>> = {
  opencode: "p-[2px]",
};

/** The tiles whose radius is 7 px instead of 6 px; static, so Tailwind finds the class. */
const TILE_RADIUS_CLASSES: Readonly<Record<string, string>> = {
  openrouter: "rounded-[7px]",
  zai: "rounded-[7px]",
};

function markStyle(mark: string): MarkStyle | null {
  return Object.hasOwn(MARK_STYLES, mark) ? (MARK_STYLES[mark] ?? null) : null;
}

/**
 * The border and background of a model field whose whole surface is the
 * model's badge.
 * @param mark - The mark key of the model's tool; `null` while no model is shown.
 * @returns Claude's orange, the green of the ChatGPT tile, Antigravity's
 * blue, OpenCode's or Z.AI's neutral grey, or OpenRouter's lime on the
 * surface; every other tool and a missing model keep the neutral field border.
 */
export function modelChoiceFieldClass(mark: string | null): string {
  const style = mark === null ? null : markStyle(mark);
  return cn("bg-surface", style?.borderClass ?? "border-field-border");
}

export interface ModelChoiceBadgeProps {
  /** The mark key of the model's tool, such as `claude` or `openai`. */
  readonly mark: string;
  /** The model's short catalog name, such as `Sonnet 5.5`. */
  readonly name: string;
  /**
   * The model's ID, such as `glm-5.3-flash`. A Z.AI model names it in the
   * tooltip and the accessible name beside the catalog name; other tools
   * ignore it. Absent when unknown.
   */
  readonly modelId?: string;
  /** The tool the model is listed under; it names a tool without a brand of its own. */
  readonly tool: string;
  /** Where the tool takes the model from, such as `OpenCode Zen`; `null` or absent when unknown. */
  readonly source?: string | null;
  /** Why a saved model is unavailable, when the field can only show its ID. */
  readonly unavailableHint?: string;
  /** Exposes the tooltip on keyboard focus in a read-only field. */
  readonly isFocusable?: boolean;
  readonly className?: string;
}

/** The catalog name with the model ID in brackets, where the tool names the ID. */
function namedModel(
  style: MarkStyle | null,
  choice: ModelChoiceBadgeProps,
): string {
  const { name, modelId } = choice;
  if (style?.isIdNamed !== true || !modelId || modelId === name) return name;
  return `${name} (${modelId})`;
}

/** The full model name, execution route and known source of a model field. */
export function modelChoiceLabel(choice: ModelChoiceBadgeProps): string {
  const style = markStyle(choice.mark);
  return [
    style?.vendor ?? choice.tool,
    choice.source,
    namedModel(style, choice),
    choice.unavailableHint,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The chosen model inside a model field: the tool's unchanged 28 px tile
 * and the catalog name.
 * @remarks
 * The field around it is the badge, outlined by
 * {@link modelChoiceFieldClass}, so the content has no border of its own.
 * The tile has a 6 px radius, 7 px for OpenRouter and Z.AI, and stands 6 px before
 * the name in the foreground color. The vendor, such as `Anthropic`, is no part of the
 * visible text; it stands in the tooltip and the accessible name beside the
 * full name, followed by a known source such as `OpenCode Zen`. OpenCode's
 * mark keeps a 2 px white rim in the tile. A name that does not fit, roughly
 * beyond 11 characters, is cut with an ellipsis.
 */
export function ModelChoiceBadge(
  props: ModelChoiceBadgeProps,
): React.ReactElement {
  const { mark, name, className, isFocusable } = props;
  const label = modelChoiceLabel(props);
  const badge = (
    <span
      title={mark === "openrouter" ? undefined : label}
      tabIndex={isFocusable ? 0 : undefined}
      data-model-badge={mark}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5",
        isFocusable &&
          "rounded-sm focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
    >
      <ToolMark
        mark={mark}
        className={cn(
          "size-7 rounded-[6px]",
          TILE_RADIUS_CLASSES[mark],
          TILE_RIM_CLASSES[mark],
        )}
      />
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="min-w-0 truncate text-foreground">
        {name}
      </span>
    </span>
  );
  if (!isFocusable) return badge;
  return (
    <Tooltip
      content={<span className="wrap-anywhere">{label}</span>}
      className="min-w-0 flex-1"
      align="start"
      isFloating
    >
      {() => badge}
    </Tooltip>
  );
}
