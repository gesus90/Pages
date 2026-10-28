import { expect, it } from "vitest";

import { planSelectionCookie } from "@/app/lib/agent-plan-selection";
import { lastSelectedPlan } from "@/app/lib/agent-plan-selection.server";

const ORIGIN = "http://pages.invalid";

async function requestWithSelection(
  userId: string,
  selection: unknown,
): Promise<Request> {
  const cookie = planSelectionCookie({ userId, origin: ORIGIN });
  return new Request(`${ORIGIN}/agents/plans`, {
    headers: { Cookie: await cookie.serialize(selection) },
  });
}

it("returns the plan the account remembered on this instance", async () => {
  const request = await requestWithSelection("owner", "plan-7");

  await expect(lastSelectedPlan(request, "owner")).resolves.toBe("plan-7");
});

it("ignores the selection another account remembered", async () => {
  const request = await requestWithSelection("someone-else", "plan-7");

  await expect(lastSelectedPlan(request, "owner")).resolves.toBeNull();
});

it("ignores a selection that is not a short plan identifier", async () => {
  for (const selection of ["", "x".repeat(201), 7]) {
    const request = await requestWithSelection("owner", selection);

    await expect(lastSelectedPlan(request, "owner")).resolves.toBeNull();
  }
  const longest = await requestWithSelection("owner", "x".repeat(200));
  await expect(lastSelectedPlan(longest, "owner")).resolves.toBe(
    "x".repeat(200),
  );
});

it("treats an account identifier that cannot name a cookie as no selection", async () => {
  const request = new Request(`${ORIGIN}/agents/plans`);

  await expect(lastSelectedPlan(request, "\uD800")).resolves.toBeNull();
});
