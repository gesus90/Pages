import { Check } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { DesignThemePreview } from "@/app/components/settings/design-theme-preview";
import { useDesignThemeSelection } from "@/app/components/settings/use-design-theme-selection";
import {
  VISIBLE_DESIGN_CARD_COUNT,
  useDesignThemeViewport,
} from "@/app/components/settings/use-design-theme-viewport";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";
import { pickLocalizedText } from "@/definition/DesignTheme";

import type {
  DesignThemeChoice,
  DesignThemeSelection,
} from "@/definition/DesignTheme";

interface DesignThemeOptionProps {
  readonly choice: DesignThemeChoice;
  readonly isSelected: boolean;
  readonly onSelect: (designThemeId: string) => void;
}

function DesignThemeOption({
  choice,
  isSelected,
  onSelect,
}: DesignThemeOptionProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const [onlyMode] = choice.modes.length === 1 ? choice.modes : [];

  return (
    <button
      aria-pressed={isSelected}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl bg-surface p-3 text-left transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        isSelected
          ? "ring-2 ring-primary"
          : "ring-1 ring-border hover:bg-surface-hover",
      )}
      onClick={() => onSelect(choice.id)}
      type="button"
    >
      <DesignThemePreview choice={choice} />
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">
            {pickLocalizedText(choice.name, i18n.language)}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {pickLocalizedText(choice.description, i18n.language)}
          </span>
          {onlyMode ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              {t(`settings.appearance.design.only.${onlyMode}`)}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full",
            isSelected
              ? "bg-primary text-primary-foreground"
              : "ring-1 ring-border",
          )}
        >
          {isSelected ? <Check className="size-3.5" /> : null}
        </span>
      </span>
    </button>
  );
}

interface DesignThemeCardsProps {
  readonly choices: readonly DesignThemeChoice[];
  readonly labelId: string;
  readonly selectedId: string;
  readonly onSelect: (designThemeId: string) => void;
}

/**
 * The cards of the offered designs.
 *
 * @remarks
 * Up to four designs show as a plain grid. With more, the grid scrolls inside
 * the picker with the usual fades of Pages and shows four complete cards and
 * a little of the next row. The inner padding keeps the selection ring and
 * the focus outline of a card clear of the scroll edges.
 */
function DesignThemeCards({
  choices,
  labelId,
  selectedId,
  onSelect,
}: DesignThemeCardsProps): React.ReactElement {
  const { gridRef, viewportRef, maxHeight } = useDesignThemeViewport(
    choices.length,
  );
  const grid = (
    <div
      aria-labelledby={labelId}
      className="grid gap-3 sm:grid-cols-2"
      ref={gridRef}
      role="group"
    >
      {choices.map((choice) => (
        <DesignThemeOption
          choice={choice}
          isSelected={choice.id === selectedId}
          key={choice.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );

  if (choices.length <= VISIBLE_DESIGN_CARD_COUNT) {
    return grid;
  }

  return (
    <ScrollViewport
      className="p-1"
      containerClassName="-m-1 [--scroll-fade-color:var(--color-surface)]"
      containerStyle={maxHeight === null ? undefined : { maxHeight }}
      ref={viewportRef}
    >
      {grid}
    </ScrollViewport>
  );
}

interface DesignThemePickerProps {
  readonly selection: DesignThemeSelection;
}

/** Offers the installed design themes as preview cards and stores the choice. */
export function DesignThemePicker({
  selection,
}: DesignThemePickerProps): React.ReactElement {
  const { t } = useTranslation();
  const labelId = useId();
  const { selectedId, error, selectDesignTheme } = useDesignThemeSelection(
    selection.selectedId,
  );

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div>
        <span className="text-sm text-muted-foreground" id={labelId}>
          {t("settings.appearance.design.label")}
        </span>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("settings.appearance.design.hint")}
        </p>
      </div>
      <DesignThemeCards
        choices={selection.choices}
        labelId={labelId}
        selectedId={selectedId}
        onSelect={selectDesignTheme}
      />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`settings.appearance.design.error.${error}`)}
        </p>
      ) : null}
      {selection.skipped.length > 0 ? (
        <div className="rounded-lg bg-warning-subtle p-3 text-xs leading-relaxed text-warning">
          <p className="font-medium">
            {t("settings.appearance.design.skipped")}
          </p>
          <ul className="mt-1 list-disc pl-4">
            {selection.skipped.map((skipped) => (
              <li key={skipped.directory}>
                <span className="font-medium">{skipped.directory}</span>
                {`: ${skipped.reason}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
