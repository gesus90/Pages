import { expect, it } from "vitest";

import { SetupMarkerFilter } from "@/backend/service/remote/setup/SetupMarkerFilter";

it("holds split markers while preserving visible terminal output", () => {
  const filter = new SetupMarkerFilter();
  expect(filter.feed("Before \u001b]777;pages-")).toEqual({
    text: "Before ",
    markers: [],
  });
  expect(filter.feed("setup;phase=1;state=done;step=\u0007 After")).toEqual({
    text: " After",
    markers: [{ phase: 1, state: "done", step: "" }],
  });
});

it("ignores malformed markers and displays an unterminated overlong sequence", () => {
  const filter = new SetupMarkerFilter();
  expect(
    filter.feed("\u001b]777;pages-setup;phase=99;state=done;step=\u0007text"),
  ).toEqual({ text: "text", markers: [] });
  const output = filter.feed(`\u001b]777;pages-setup;${"x".repeat(100)}`);
  expect(output.text).toContain("pages-setup;");
  expect(output.markers).toEqual([]);
});
