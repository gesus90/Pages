import { expect, it } from "vitest";

import { createInClause } from "./InClause";

it("numbers one placeholder per value and binds each value", () => {
  expect(createInClause("id", ["a", "b"])).toEqual({
    parameters: { id_0: "a", id_1: "b" },
    placeholders: "$id_0, $id_1",
  });
});

it("returns empty placeholders for no values", () => {
  expect(createInClause("id", [])).toEqual({
    parameters: {},
    placeholders: "",
  });
});
