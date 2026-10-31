import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { loadSelection } from "@/app/lib/task-selection.server";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Label, WorkItemDetail } from "@/definition/Task";
import type { Route } from "./+types/task-panel-data";

/** Loads only the requested ticket and its detail data for the board overlay. */
export async function loader({ context, params }: Route.LoaderArgs): Promise<{
  readonly key: string;
  readonly selection: Awaited<ReturnType<typeof loadSelection>> | null;
  readonly labels: readonly Label[];
  readonly related: readonly WorkItemDetail[];
  readonly labelUsage: Readonly<Record<string, number>>;
}> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });

  const labelsByWorkItem: Record<string, readonly Label[]> = {};
  try {
    const services = await getApplicationServices();
    const selection = await loadSelection(services, {
      actor,
      labelsByWorkItem,
      selectedKey: params.ticketKey,
      workItems: [],
    });

    const parentKey = selection.selectedItem?.parentKey;
    const related: WorkItemDetail[] = [];
    if (parentKey) {
      try {
        related.push(await services.taskService.getByKey(actor, parentKey));
      } catch (error: unknown) {
        logCaughtError("task_panel_parent", error);
      }
    }

    return {
      key: params.ticketKey,
      labels: selection.selectedItem
        ? (labelsByWorkItem[selection.selectedItem.id] ?? [])
        : [],
      selection,
      related,
      labelUsage: Object.fromEntries(
        await services.taskService.countLabelUsage(actor),
      ),
    };
  } catch (error: unknown) {
    logCaughtError("task_panel_data", error);
    return {
      key: params.ticketKey,
      labels: [],
      selection: null,
      related: [],
      labelUsage: {},
    };
  }
}
