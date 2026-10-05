import { useTranslation } from "react-i18next";

import { StatusPill } from "@/app/components/projects/integration-fields";
import { ServiceIcon } from "@/app/components/projects/integration-service-icon";
import { cn } from "@/app/lib/cn";

import type { IntegrationId } from "@/app/components/projects/integration-service-icon";

interface IntegrationCardProps {
  readonly id: IntegrationId;
  readonly name: string;
  readonly description: string;
  readonly connected: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: IntegrationId) => void;
}

/**
 * Renders one large clickable interface card without any nested action buttons.
 *
 * @remarks
 * The whole card is a single native button, so keyboard and screen-reader
 * users get the same "open the settings panel" behavior as pointer users.
 */
export function IntegrationCard({
  id,
  name,
  description,
  connected,
  selected,
  onSelect,
}: IntegrationCardProps): React.ReactElement {
  const { t } = useTranslation();

  function handleSelect(): void {
    onSelect(id);
  }

  return (
    <button
      aria-pressed={selected}
      aria-label={t("projectDetail.interfaces.openSettings", { name })}
      className={cn(
        "flex w-full cursor-pointer items-start gap-4 rounded-2xl border bg-surface p-5 text-left shadow-xs transition-all outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary",
        selected
          ? "border-orange-500 bg-orange-50/60"
          : "border-border hover:border-orange-300",
      )}
      onClick={handleSelect}
      type="button"
    >
      <ServiceIcon id={id} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <StatusPill connected={connected} />
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

interface PlannedIntegrationCardProps {
  readonly id: IntegrationId;
  readonly name: string;
  readonly description: string;
}

/**
 * Renders an interface that is announced but not available yet.
 *
 * @remarks
 * The card is no button and opens nothing, so the tab never suggests
 * settings that nothing stores or sends.
 */
export function PlannedIntegrationCard({
  id,
  name,
  description,
}: PlannedIntegrationCardProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex w-full items-start gap-4 rounded-2xl border border-dashed border-border bg-surface/60 p-5">
      <ServiceIcon id={id} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-muted-foreground select-none">
            {t("projectDetail.interfaces.planned")}
          </span>
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </div>
  );
}
