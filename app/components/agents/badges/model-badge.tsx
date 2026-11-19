import { useTranslation } from "react-i18next";

import { Tooltip } from "@/app/components/ui/tooltip";
import { cn } from "@/app/lib/cn";

import { ToolMark } from "../model-picker/tool-mark";

import type {
  AgentValueStatus,
  ModelBadgeVendor,
} from "@/definition/AgentModelIdentity";

interface VendorStyle {
  /** The key of the vendor's unchanged tile. */
  readonly mark: string;
  /** The vendor's or tool's brand name, never translated. */
  readonly name: string;
  /** The outline in the color of the tile; static, so Tailwind finds the class. */
  readonly borderClass: string;
  /** Whether the model ID stands beside the catalog name in the tooltip and the accessible name. */
  readonly isIdNamed?: boolean;
}

const VENDOR_STYLES: Readonly<Record<ModelBadgeVendor, VendorStyle>> = {
  anthropic: {
    mark: "claude",
    name: "Anthropic",
    borderClass: "border-claude",
  },
  openai: { mark: "openai", name: "OpenAI", borderClass: "border-chatgpt" },
  antigravity: {
    mark: "antigravity",
    name: "Antigravity",
    borderClass: "border-antigravity",
  },
  opencode: {
    mark: "opencode",
    name: "OpenCode",
    borderClass: "border-opencode",
  },
  openrouter: {
    mark: "openrouter",
    name: "OpenRouter",
    borderClass: "border-openrouter",
  },
  zai: {
    mark: "zai",
    name: "Z.AI",
    borderClass: "border-zai",
    isIdNamed: true,
  },
};

interface ModelBadgeProps {
  readonly vendor: ModelBadgeVendor;
  /** The catalog name, such as `Haiku 5.5`, `GPT-6.2 Sol` or `Gemini 4 Argon`. */
  readonly name: string;
  /**
   * The model's ID, such as `glm-5.3-flash`. A Z.AI badge names it in the
   * tooltip and the accessible name beside the catalog name; the badges of
   * other vendors ignore it. `null` or absent when unknown.
   */
  readonly modelId?: string | null;
  readonly status?: AgentValueStatus;
  /**
   * Where the tool takes the model from, such as `OpenCode Zen`; it stands in
   * the tooltip and the accessible name only, `null` or absent when unknown.
   */
  readonly source?: string | null;
  /**
   * Drops the vendor word and its divider in a container narrower than
   * 520 px, so tile and name remain; the caller provides the container.
   */
  readonly isVendorHiddenWhenNarrow?: boolean;
  /** Focusable tooltip for a standalone badge. Omit it inside a control. */
  readonly hasKeyboardTooltip?: boolean;
  /**
   * Drops the vendor word and its divider at every width: the compact badge
   * of the console sidebar. Tile and outline still name the vendor, and the
   * tooltip and the accessible name keep vendor and model.
   */
  readonly isVendorHidden?: boolean;
  readonly className?: string;
}

// Static, so Tailwind finds the classes: hidden below 520 px of the nearest
// container, shown from there on.
const NARROW_VENDOR_CLASS = "hidden @min-[520px]:inline";
const NARROW_DIVIDER_CLASS = "hidden @min-[520px]:block";

interface ModelBadgeFaceProps {
  readonly style: VendorStyle;
  readonly name: string;
  readonly isVendorHiddenWhenNarrow: boolean;
  readonly isVendorHidden: boolean;
}

/** The tile, the vendor word, its divider and the model name inside the badge outline. */
function ModelBadgeFace({
  style,
  name,
  isVendorHiddenWhenNarrow,
  isVendorHidden,
}: ModelBadgeFaceProps): React.ReactElement {
  return (
    <>
      <ToolMark mark={style.mark} className="size-[18px] rounded-[5px]" />
      <span
        className={cn(
          "shrink-0 font-normal text-muted-foreground",
          isVendorHiddenWhenNarrow && NARROW_VENDOR_CLASS,
          isVendorHidden && "hidden",
        )}
      >
        {style.name}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "h-3 w-px shrink-0 bg-border",
          isVendorHiddenWhenNarrow && NARROW_DIVIDER_CLASS,
          isVendorHidden && "hidden",
        )}
      />
      <span className="min-w-0 truncate font-semibold text-foreground">
        {name}
      </span>
    </>
  );
}

/** The name for the tooltip and the accessible name: with the model ID in brackets where the vendor names it. */
function namedModel(
  style: VendorStyle,
  name: string,
  modelId: string | null | undefined,
): string {
  if (!style.isIdNamed || !modelId || modelId === name) return name;
  return `${name} (${modelId})`;
}

/**
 * The model badge of a vendor: its unchanged tile, the vendor and the
 * catalog name, outlined in the color of the tile.
 * @remarks
 * 24 px high with a 1 px border and a 7 px radius; the 18 px tile with a 5 px
 * radius sits 2 px from the top, bottom and left edge, so the corners run
 * parallel. Anthropic is outlined in Claude's orange, OpenAI in the green of
 * the ChatGPT tile, Antigravity in its blue, OpenCode in its neutral grey,
 * OpenRouter in lime and Z.AI in its neutral grey. A known source of the model,
 * such as OpenCode Zen or an OpenRouter model's manufacturer, stands in the
 * tooltip and accessible name, and so does the ID of a Z.AI model. A long name
 * is cut with an ellipsis while the tile and the vendor stay whole. The border
 * is always solid; whether the adapter confirmed the model stands in the
 * tooltip and the accessible name.
 */
export function ModelBadge({
  vendor,
  name,
  modelId,
  status = "configured",
  source = null,
  isVendorHiddenWhenNarrow = false,
  hasKeyboardTooltip = vendor === "openrouter",
  isVendorHidden = false,
  className,
}: ModelBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const style = VENDOR_STYLES[vendor];
  const statusText = t(`agentBadges.model.status.${status}`);
  const sourceText =
    source === null ? "" : ` · ${t("agentBadges.model.source", { source })}`;
  const fullName = namedModel(style, name, modelId);
  const label = t(
    source === null
      ? "agentBadges.model.label"
      : "agentBadges.model.labelWithSource",
    { vendor: style.name, name: fullName, status: statusText, source },
  );
  const title = `${style.name} ${fullName}${sourceText} · ${statusText}`;
  const badge = (
    <span
      title={hasKeyboardTooltip ? undefined : title}
      aria-label={label}
      role={isVendorHidden || vendor === "openrouter" ? "img" : undefined}
      tabIndex={hasKeyboardTooltip ? 0 : undefined}
      data-model-badge={style.mark}
      data-value-status={status}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 shrink items-center gap-[7px] rounded-[7px] border bg-surface py-[2px] pr-2 pl-[2px] text-[11px] leading-4",
        style.borderClass,
        hasKeyboardTooltip &&
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary focus-visible:outline-none",
        className,
      )}
    >
      <ModelBadgeFace
        style={style}
        name={name}
        isVendorHiddenWhenNarrow={isVendorHiddenWhenNarrow}
        isVendorHidden={isVendorHidden}
      />
    </span>
  );
  if (!hasKeyboardTooltip) return badge;
  return (
    <Tooltip
      className="max-w-full min-w-0 shrink"
      content={<span className="whitespace-normal wrap-anywhere">{title}</span>}
      align="start"
      isFloating
    >
      {() => badge}
    </Tooltip>
  );
}
