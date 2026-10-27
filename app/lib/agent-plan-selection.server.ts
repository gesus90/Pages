import { planSelectionCookie } from "./agent-plan-selection";

/** Reads a browser preference only for its account; every plan is still authorized by the loader. */
export async function lastSelectedPlan(
  request: Request,
  userId: string,
): Promise<string | null> {
  let selection: unknown;
  try {
    selection = await planSelectionCookie({
      userId,
      origin: new URL(request.url).origin,
    }).parse(request.headers.get("Cookie"));
  } catch {
    return null;
  }
  return typeof selection === "string" &&
    selection.length > 0 &&
    selection.length <= 200
    ? selection
    : null;
}
