import { useState } from "react";

/** The two lists of the palette: node types and saved templates. */
export type PlanPaletteTab = "nodes" | "templates";

/** Whether the palette is open and which list it shows. */
export interface PlanPaletteView {
  readonly isOpen: boolean;
  readonly tab: PlanPaletteTab;
  readonly toggle: () => void;
  readonly select: (tab: PlanPaletteTab) => void;
  /** Opens the palette on its templates, as after a template was saved. */
  readonly showTemplates: () => void;
}

/**
 * The open state and tab of the palette overlay.
 *
 * @remarks
 * Both stay in the editor only; neither touches the graph, the canvas size
 * or its viewport.
 */
export function usePlanPaletteView(): PlanPaletteView {
  const [isOpen, setOpen] = useState(true);
  const [tab, setTab] = useState<PlanPaletteTab>("nodes");
  return {
    isOpen,
    tab,
    toggle: () => setOpen(!isOpen),
    select: setTab,
    showTemplates: () => {
      setOpen(true);
      setTab("templates");
    },
  };
}
