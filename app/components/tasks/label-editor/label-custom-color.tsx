import { Pipette } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { HexagonColorPicker } from "@/app/components/tasks/hexagon-color-picker";
import { Button } from "@/app/components/ui/button";

interface LabelCustomColorProps {
  readonly color: string;
  readonly onChange: (color: string) => void;
}

/** Renders the toggle that expands the free hexagon color picker. */
export function LabelCustomColor({
  color,
  onChange,
}: LabelCustomColorProps): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <Button
        className="h-8 gap-1.5 px-3 text-xs"
        onClick={() => setIsOpen((previous) => !previous)}
        type="button"
        variant="outline"
        aria-expanded={isOpen}
      >
        <Pipette className="size-3.5" aria-hidden="true" />
        {t("tasks.labels.customColor")}
      </Button>

      {isOpen ? (
        <div className="mt-3 rounded-xl bg-muted/40 p-3">
          <HexagonColorPicker color={color} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
}
