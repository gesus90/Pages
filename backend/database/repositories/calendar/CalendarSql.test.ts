import { expect, it } from "vitest";

import { calendarInList } from "./CalendarSql";

it("matches nothing for an empty list", () => {
  expect(calendarInList("id", [])).toEqual({
    placeholders: "NULL",
    parameters: {},
  });
});

it("numbers the placeholders of a filled list", () => {
  const list = calendarInList("id", ["a", "b"]);

  expect(Object.values(list.parameters)).toEqual(["a", "b"]);
  expect(list.placeholders.split(",")).toHaveLength(2);
});
