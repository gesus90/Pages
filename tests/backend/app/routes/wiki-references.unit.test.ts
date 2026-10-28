import { expect, it, vi } from "vitest";

import { loader } from "@/app/routes/wiki-references";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const references = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ wikiService: { references } }),
}));

function load(user: User | null, query: string): Promise<Response> {
  return loader(
    routeArguments(
      new Request(`http://pages.invalid/wiki-api/references${query}`),
      user,
      {},
    ),
  );
}

it("refuses visitors without a session", async () => {
  expect((await thrownResponse(load(null, "?q=a"))).status).toBe(403);
  expect(references).not.toHaveBeenCalled();
});

it("offers the references that match the query", async () => {
  references.mockResolvedValue([{ kind: "page", id: "p1" }]);
  const response = await load(EMPLOYEE, "?q=Plan");
  expect(await response.json()).toEqual({
    references: [{ kind: "page", id: "p1" }],
  });
  expect(references).toHaveBeenCalledWith(EMPLOYEE, "Plan");
});

it("searches with an empty query when none is given", async () => {
  references.mockResolvedValue([]);
  await load(EMPLOYEE, "");
  expect(references).toHaveBeenLastCalledWith(EMPLOYEE, "");
});
