import { Flag, Kanban, List, Network } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SegmentedControl } from "@/app/components/ui/segmented-control";

import type { SegmentedControlOption } from "@/app/components/ui/segmented-control";
import type { BoardView } from "@/definition/BoardPreferences";

interface ToolbarViewSwitchProps {
  readonly view: BoardView;
  readonly onViewChange: (view: BoardView) => void;
}

/** Renders the switch between the kanban, list, hierarchy, milestone and GitHub views. */
export function ToolbarViewSwitch({
  view,
  onViewChange,
}: ToolbarViewSwitchProps): React.ReactElement {
  const { t } = useTranslation();
  const options: SegmentedControlOption<BoardView>[] = [
    {
      icon: <Kanban className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.kanban"),
      value: "kanban",
    },
    {
      icon: <List className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.list"),
      value: "list",
    },
    {
      icon: <Network className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.hierarchy"),
      value: "hierarchy",
    },
    {
      icon: <Flag className="size-3.5" aria-hidden="true" />,
      label: t("tasks.view.milestones"),
      value: "milestones",
    },
    { label: t("tasks.view.github"), value: "github" },
  ];

  return (
    <SegmentedControl
      ariaLabel={t("tasks.view.label")}
      className="max-w-full overflow-x-auto"
      onValueChange={onViewChange}
      options={options}
      value={view}
    />
  );
}
