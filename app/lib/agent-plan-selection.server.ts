import { createCookie } from "react-router";

import { resolveCookieSecure } from "./cookie-security.server";

const selectionCookie = createCookie("pages_plan_selection", {
  httpOnly: true,
  sameSite: "lax",
  path: "/agents/plans",
  maxAge: 31_536_000,
});

/** Reads a browser preference only for its account; every plan is still authorized by the loader. */
export async function lastSelectedPlan(
  request: Request,
  userId: string,
): Promise<string | null> {
  let selection: unknown;
  try {
    selection = await selectionCookie.parse(request.headers.get("Cookie"));
  } catch {
    return null;
  }
  if (
    typeof selection !== "object" ||
    selection === null ||
    !("userId" in selection) ||
    selection.userId !== userId ||
    !("planId" in selection)
  )
    return null;
  return typeof selection.planId === "string" && selection.planId.length <= 200
    ? selection.planId
    : null;
}

/** Stores successful explicit selection without storing graph content or execution authority. */
export async function rememberSelectedPlan(
  request: Request,
  userId: string,
  planId: string,
): Promise<string> {
  return selectionCookie.serialize(
    { userId, planId },
    { secure: resolveCookieSecure(request) },
  );
}

/** Clears the remembered plan, for example after it was deleted and no other plan is readable. */
export async function forgetSelectedPlan(request: Request): Promise<string> {
  return selectionCookie.serialize("", {
    maxAge: 0,
    expires: new Date(0),
    secure: resolveCookieSecure(request),
  });
}
