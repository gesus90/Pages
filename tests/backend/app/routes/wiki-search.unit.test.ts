import { expect, it, vi } from "vitest";

import { loader } from "@/app/routes/wiki-search";
import { WikiValidationError } from "@/backend/error/WikiErrors";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const search = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ wikiService: { search } }),
}));

function load(user: User | null): Promise<Response> {
  return loader(
    routeArguments(
      new Request("http://pages.invalid/wiki-api/search?q=Plan&titleOnly=1"),
      user,
      {},
    ),
  );
}

it("refuses visitors without a session", async () => {
  expect((await thrownResponse(load(null))).status).toBe(403);
  expect(search).not.toHaveBeenCalled();
});

it("answers the visible results of the parsed search", async () => {
  search.mockResolvedValue({ results: [{ id: "p1" }], total: 1 });
  const response = await load(EMPLOYEE);
  expect(await response.json()).toEqual({ results: [{ id: "p1" }], total: 1 });
  expect(search).toHaveBeenCalledWith(
    EMPLOYEE,
    expect.objectContaining({ text: "Plan", titleOnly: true }),
  );
});

it("answers an invalid filter with an empty result", async () => {
  search.mockRejectedValue(new WikiValidationError("invalidDate"));
  expect(await (await load(EMPLOYEE)).json()).toEqual({
    results: [],
    total: 0,
  });
});

it("rethrows an unexpected failure", async () => {
  const failure = new Error("database");
  search.mockRejectedValue(failure);
  await expect(load(EMPLOYEE)).rejects.toBe(failure);
});
