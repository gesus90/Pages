import { ArrowDown, ArrowUp, ChevronDown, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/cn";

import { TICKET_SORTS } from "./ticket-picker-results";

import type { AgentPlanPhase } from "@/definition/AgentPlan";
import type { TicketSort } from "./ticket-picker-results";
import type { TicketPickerState } from "./use-ticket-picker";

/** Finds menus of the ticket choice, whose portals still belong to its panel. */
export const TICKET_PICKER_MENU = "[data-ticket-picker-menu]";

const FIELD_CLASS =
  "flex h-[1.9375rem] min-w-0 items-center rounded-[0.3125rem] border border-ticket-picker-field bg-transparent text-[13px] tracking-tight text-ticket-picker-foreground outline-none transition-colors hover:bg-ticket-picker-hover focus-visible:ring-2 focus-visible:ring-ring";
const LABEL_CLASS =
  "shrink-0 text-[13px] tracking-tight text-ticket-picker-muted";

interface FilterProps {
  readonly state: TicketPickerState;
  readonly phases: readonly AgentPlanPhase[];
}

function sortIsSelected(value: string): value is TicketSort {
  return TICKET_SORTS.some((sort) => sort === value);
}

/** The phase filter as a menu; it and the chips edit the same phases. */
function PhaseMenu({ state, phases }: FilterProps): React.ReactElement {
  const { t } = useTranslation();
  const chosen = phases.filter((phase) =>
    state.query.phases.includes(phase.key),
  );
  let label = t("plans.ticketPicker.allPhases");
  if (chosen.length === 1) label = chosen[0]?.name ?? label;
  if (chosen.length > 1)
    label = t("plans.ticketPicker.phaseCount", { count: chosen.length });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("plans.ticketPicker.phaseFilter", { value: label })}
          className={cn(FIELD_CLASS, "w-[11.625rem] gap-3 pr-3 pl-2.5")}
        >
          <Filter className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-ticket-picker-menu=""
        align="start"
        sideOffset={4}
      >
        <DropdownMenuCheckboxItem
          checked={state.query.phases.length === 0}
          onCheckedChange={() => state.setPhases([])}
          onSelect={(event) => event.preventDefault()}
        >
          {t("plans.ticketPicker.allPhases")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {phases.map((phase) => (
          <DropdownMenuCheckboxItem
            key={phase.key}
            checked={state.query.phases.includes(phase.key)}
            onCheckedChange={() => state.togglePhase(phase.key)}
            onSelect={(event) => event.preventDefault()}
          >
            {phase.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The order menu; its field names the order together with its direction. */
function SortMenu({ state }: Pick<FilterProps, "state">): React.ReactElement {
  const { t } = useTranslation();
  const { sort, direction } = state.query;
  function choose(value: string): void {
    if (sortIsSelected(value)) state.sortBy(value);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("plans.ticketPicker.sortField", {
            value: t(`plans.ticketPicker.order.${sort}.${direction}`),
          })}
          className={cn(FIELD_CLASS, "w-40 gap-2 pr-3 pl-2.5")}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {t(`plans.ticketPicker.order.${sort}.${direction}`)}
          </span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-ticket-picker-menu=""
        align="start"
        sideOffset={4}
      >
        <DropdownMenuRadioGroup value={sort} onValueChange={choose}>
          {TICKET_SORTS.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {t(`plans.ticketPicker.sort.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DirectionButton({
  state,
}: Pick<FilterProps, "state">): React.ReactElement {
  const { t } = useTranslation();
  const { sort, direction } = state.query;
  const Icon = direction === "asc" ? ArrowUp : ArrowDown;
  const label = t("plans.ticketPicker.direction", {
    value: t(`plans.ticketPicker.order.${sort}.${direction}`),
  });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        FIELD_CLASS,
        "ml-2.5 w-[1.9375rem] shrink-0 justify-center",
      )}
      onClick={state.toggleDirection}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

/** Kanban phase and order, side by side; on a narrow window they wrap. */
export function TicketPickerFilters(props: FilterProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center">
        <span className={cn(LABEL_CLASS, "w-[6.3rem]")}>
          {t("plans.ticketPicker.phase")}
        </span>
        <PhaseMenu {...props} />
      </div>
      <div className="flex min-w-0 items-center">
        <span className={cn(LABEL_CLASS, "mr-4")}>
          {t("plans.ticketPicker.sortLabel")}
        </span>
        <SortMenu state={props.state} />
        <DirectionButton state={props.state} />
      </div>
    </div>
  );
}

/** The phase chips; Alle clears the filter, every phase toggles its own. */
export function TicketPickerChips({
  state,
  phases,
}: FilterProps): React.ReactElement {
  const { t } = useTranslation();
  const chips = [
    {
      key: "",
      name: t("plans.ticketPicker.all"),
      isPressed: state.query.phases.length === 0,
    },
    ...phases.map((phase) => ({
      key: phase.key,
      name: phase.name,
      isPressed: state.query.phases.includes(phase.key),
    })),
  ];
  return (
    <div
      role="group"
      aria-label={t("plans.ticketPicker.phase")}
      className="mt-[0.6875rem] mb-2 flex flex-wrap gap-2"
    >
      {chips.map((chip) => (
        <button
          key={chip.key || "all"}
          type="button"
          aria-pressed={chip.isPressed}
          className={cn(
            "h-[1.4375rem] min-w-12 rounded-full border px-3 text-[12px] leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            chip.isPressed
              ? "border-ticket-picker-active-edge bg-ticket-picker-active text-ticket-picker-active-foreground shadow-[inset_0_0_0.5rem_var(--color-ticket-picker-active-edge),0_0_0.5rem_var(--color-ticket-picker-active)]"
              : "border-ticket-picker-field bg-ticket-picker-chip text-ticket-picker-foreground hover:bg-ticket-picker-hover",
          )}
          onClick={() =>
            chip.key ? state.togglePhase(chip.key) : state.setPhases([])
          }
        >
          {chip.name}
        </button>
      ))}
    </div>
  );
}
