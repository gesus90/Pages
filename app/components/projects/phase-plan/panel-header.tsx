import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MilestoneMarkerIcon } from "@/app/components/projects/phase-plan/milestone-symbol";
import { SymbolColorPicker } from "@/app/components/projects/phase-plan/symbol-color-picker";
import { COLOR_DEFAULT_ICON } from "@/app/lib/phase-plan/plan-milestones";

import type { PanelDraft } from "@/app/lib/phase-plan/plan-types";
import type { MilestoneIcon } from "@/definition/Task";

interface PanelHeaderProps {
  readonly draft: PanelDraft;
  readonly draftHex: string;
  readonly pickerOpen: boolean;
  readonly onTogglePicker: () => void;
  readonly onClosePicker: () => void;
  readonly onSelectIcon: (icon: MilestoneIcon) => void;
  readonly onSelectCustom: (hex: string | null) => void;
  readonly onClose: () => void;
}

/** Renders the symbol button with its picker, the title and the close button. */
export function PanelHeader({
  draft,
  draftHex,
  pickerOpen,
  onTogglePicker,
  onClosePicker,
  onSelectIcon,
  onSelectCustom,
  onClose,
}: PanelHeaderProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center gap-3 px-5 pt-5 pb-3">
      <div className="relative shrink-0">
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-primary"
          style={{ backgroundColor: `${draftHex}26`, color: draftHex }}
          aria-label={t("projectDetail.planning.phasePlan.symbol")}
          aria-expanded={pickerOpen}
          onClick={onTogglePicker}
        >
          <MilestoneMarkerIcon
            icon={draft.icon}
            color={draft.color}
            className="size-5 shrink-0"
          />
        </button>
        {pickerOpen ? (
          <SymbolColorPicker
            selectedIcon={draft.icon ?? COLOR_DEFAULT_ICON[draft.color]}
            selectedHex={draftHex}
            initialCustom={draft.custom}
            onIconChange={onSelectIcon}
            onPresetChange={onSelectCustom}
            onCustomChange={onSelectCustom}
            onClose={onClosePicker}
          />
        ) : null}
      </div>
      <h3 className="min-w-0 flex-1 text-lg font-semibold text-foreground">
        {t("projectDetail.planning.phasePlan.panelTitle")}
      </h3>
      <button
        type="button"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={t("projectDetail.planning.phasePlan.closePanel")}
        onClick={onClose}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
