import { expect, it, vi } from "vitest";

import { loader } from "@/app/routes/wiki-link-titles";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const linkTitles = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ wikiService: { linkTitles } }),
}));

function load(user: User | null, query: string): Promise<Response> {
  return loader(
    routeArguments(
      new Request(`http://pages.invalid/wiki-api/link-titles${query}`),
      user,
      {},
    ),
  );
}

it("refuses visitors without a session", async () => {
  expect((await thrownResponse(load(null, "?ids=a"))).status).toBe(403);
  expect(linkTitles).not.toHaveBeenCalled();
});

it("resolves the visible titles of at most 50 non-empty identifiers", async () => {
  linkTitles.mockResolvedValue({ a: "Alpha" });
  const ids = Array.from({ length: 60 }, (_, index) => `p${index}`);
  const response = await load(EMPLOYEE, `?ids=,${ids.join(",")},`);
  expect(await response.json()).toEqual({ titles: { a: "Alpha" } });
  expect(linkTitles).toHaveBeenCalledWith(EMPLOYEE, ids.slice(0, 50));
});

it("resolves nothing without identifiers", async () => {
  linkTitles.mockResolvedValue({});
  await load(EMPLOYEE, "");
  expect(linkTitles).toHaveBeenLastCalledWith(EMPLOYEE, []);
});
