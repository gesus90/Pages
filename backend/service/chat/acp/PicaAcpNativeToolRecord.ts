import type { PicaAcpJobDependencies } from "./PicaAcpJobDependencies";
import type { PicaNativeToolEvent } from "./PicaAcpToolCalls";

/** Records each finished host tool call once for the dream run (PAGE-378). */
export function notePicaNativeTool(
  event: PicaNativeToolEvent,
  notedCalls: Set<string>,
  recipes: PicaAcpJobDependencies["recipes"],
): void {
  if (event.status === "running" || notedCalls.has(event.callId)) return;
  notedCalls.add(event.callId);
  // The prefix distinguishes a host tool from one callable by a recipe.
  recipes?.note({
    tool: `host:${event.tool}`,
    input: event.input ?? "",
    output: event.output ?? "",
    isOk: event.status === "completed",
    error: event.error,
  });
}
