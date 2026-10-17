import type { PlanGraphActions } from "./use-plan-graph";

// Keys that delete the selected node or connection while the grid has focus.
const DELETE_KEYS = new Set(["Delete", "Backspace"]);

/**
 * Whether a key pressed on this element may delete the selection.
 *
 * @remarks
 * Only the grid itself and the handle of the selected node qualify. Fields,
 * menus, dialogs and every other control keep Delete and Backspace for
 * themselves.
 */
function deletesSelection(
  event: React.KeyboardEvent<HTMLElement>,
  selectedId: string | null,
): boolean {
  const target = event.target;
  if (target === event.currentTarget) return true;
  return (
    target instanceof HTMLElement &&
    selectedId !== null &&
    target.dataset.planHandle === selectedId
  );
}

/**
 * Keyboard of the plan grid: Delete or Backspace removes the selection,
 * Escape ends a drag or an open connection.
 */
export function usePlanCanvasKeys(options: {
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
  readonly onCancel: () => void;
}): (event: React.KeyboardEvent<HTMLElement>) => void {
  const { graph, canEdit } = options;
  return (event) => {
    if (event.key === "Escape") {
      options.onCancel();
      graph.begin(null);
      return;
    }
    const { selectedLink, selectedId } = graph;
    if (!canEdit || !DELETE_KEYS.has(event.key)) return;
    if (!deletesSelection(event, selectedId)) return;
    if (!selectedLink && !selectedId) return;
    event.preventDefault();
    if (selectedLink) graph.disconnect(selectedLink);
    else if (selectedId) graph.remove(selectedId);
  };
}
