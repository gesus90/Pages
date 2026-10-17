import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

interface SidebarToggleProps {
  readonly isCollapsed: boolean;
  /** Identifier of the navigation area the button shows and hides. */
  readonly controlsId: string;
  readonly onToggle: () => void;
}

/**
 * Collapses the open sidebar and opens it again from the narrow strip.
 *
 * @remarks
 * One button for both states keeps the keyboard focus on it while the
 * sidebar changes.
 */
export function SidebarToggle({
  isCollapsed,
  controlsId,
  onToggle,
}: SidebarToggleProps): React.ReactElement {
  const { t } = useTranslation();
  const label = t(isCollapsed ? "navigation.expand" : "navigation.collapse");
  const Icon = isCollapsed ? ChevronsRight : ChevronsLeft;

  return (
    <Button
      aria-controls={controlsId}
      aria-expanded={!isCollapsed}
      aria-label={label}
      className="absolute top-6 right-2 z-10 text-muted-foreground hover:text-foreground xl:top-4"
      size="icon-sm"
      title={label}
      variant="ghost"
      onClick={onToggle}
    >
      <Icon aria-hidden="true" className="size-4" />
    </Button>
  );
}
