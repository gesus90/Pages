import { useTranslation } from "react-i18next";

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
  zai: { mark: "zai", name: "Z.AI", borderClass: "border-zai" },
};

interface ModelBadgeProps {
  readonly vendor: ModelBadgeVendor;
  /** The catalog name, such as `Haiku 5.5`, `GPT-6.2 Sol` or `Gemini 4 Argon`. */
  readonly name: string;
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
  readonly className?: string;
}

// Static, so Tailwind finds the classes: hidden below 520 px of the nearest
// container, shown from there on.
const NARROW_VENDOR_CLASS = "hidden @min-[520px]:inline";
const NARROW_DIVIDER_CLASS = "hidden @min-[520px]:block";

/**
 * The model badge of a vendor: its unchanged tile, the vendor and the
 * catalog name, outlined in the color of the tile.
 * @remarks
 * 24 px high with a 1 px border and a 7 px radius; the 18 px tile with a 5 px
 * radius sits 2 px from the top, bottom and left edge, so the corners run
 * parallel. Anthropic is outlined in Claude's orange, OpenAI in the green of
 * the ChatGPT tile, Antigravity in its blue, OpenCode in its neutral grey and
 * the direct Z.AI connection in the anthracite of its tile, which turns white
 * in the dark palette. Antigravity and OpenCode name the tool, not the
 * model's vendor, because they offer models of several vendors: Antigravity's Sonnet keeps the
 * Antigravity tile and outline and never reads like Sonnet over Claude Code,
 * and a Gemini model over OpenCode reads "OpenCode │ Gemini …". A known
 * source of the model, such as OpenCode Zen, stands in the tooltip and the
 * accessible name. Vendor and model name stay apart until here. A long name
 * is cut with an ellipsis while the tile and the vendor stay whole. The border
 * is always solid; whether the adapter confirmed the model stands in the
 * tooltip and the accessible name.
 */
export function ModelBadge({
  vendor,
  name,
  status = "configured",
  source = null,
  isVendorHiddenWhenNarrow = false,
  className,
}: ModelBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const style = VENDOR_STYLES[vendor];
  const statusText = t(`agentBadges.model.status.${status}`);
  const sourceText =
    source === null ? "" : ` · ${t("agentBadges.model.source", { source })}`;
  const values = { vendor: style.name, name, status: statusText, source };
  return (
    <span
      title={`${style.name} ${name}${sourceText} · ${statusText}`}
      aria-label={t(
        source === null
          ? "agentBadges.model.label"
          : "agentBadges.model.labelWithSource",
        values,
      )}
      data-model-badge={style.mark}
      data-value-status={status}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 shrink items-center gap-[7px] rounded-[7px] border bg-surface py-[2px] pr-2 pl-[2px] text-[11px] leading-4",
        style.borderClass,
        className,
      )}
    >
      <ToolMark mark={style.mark} className="size-[18px] rounded-[5px]" />
      <span
        className={cn(
          "shrink-0 text-muted-foreground",
          isVendorHiddenWhenNarrow && NARROW_VENDOR_CLASS,
        )}
      >
        {style.name}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "h-3 w-px shrink-0 bg-border",
          isVendorHiddenWhenNarrow && NARROW_DIVIDER_CLASS,
        )}
      />
      <span className="min-w-0 truncate font-semibold text-foreground">
        {name}
      </span>
    </span>
  );
}
