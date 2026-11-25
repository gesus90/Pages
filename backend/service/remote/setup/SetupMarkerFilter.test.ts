import { describe, expect, it } from "vitest";

import { SetupMarkerFilter } from "./SetupMarkerFilter";

const START = "\u001b]777;pages-setup;";
const END = "\u0007";

function marker(body: string): string {
  return `${START}${body}${END}`;
}

describe("SetupMarkerFilter", () => {
  it("passes plain text through", () => {
    expect(new SetupMarkerFilter().feed("hello")).toEqual({
      text: "hello",
      markers: [],
    });
  });

  it("separates markers from text", () => {
    const result = new SetupMarkerFilter().feed(
      `a${marker("phase=2;state=waiting;step=pairing")}b`,
    );

    expect(result.text).toBe("ab");
    expect(result.markers).toEqual([
      { phase: 2, state: "waiting", step: "pairing" },
    ]);
  });

  it("drops a malformed marker body", () => {
    const result = new SetupMarkerFilter().feed(
      `x${marker("phase=9;state=done;step=")}y`,
    );

    expect(result).toEqual({ text: "xy", markers: [] });
  });

  it("holds back a partial introducer and a split marker", () => {
    const filter = new SetupMarkerFilter();

    expect(filter.feed("text\u001b]77")).toEqual({
      text: "text",
      markers: [],
    });
    expect(filter.feed("7;pages-setup;phase=1;state=")).toEqual({
      text: "",
      markers: [],
    });
    expect(filter.feed(`done;step=${END}!`)).toEqual({
      text: "!",
      markers: [{ phase: 1, state: "done", step: "" }],
    });
  });

  it("releases an escape that is no introducer", () => {
    const filter = new SetupMarkerFilter();

    filter.feed("\u001b]");

    expect(filter.feed("x").text).toBe("\u001b]x");
  });

  it("shows an introducer that is never terminated", () => {
    const long = `${START}${"a".repeat(120)}`;

    const result = new SetupMarkerFilter().feed(long);

    expect(result.text).toBe(long);
  });

  it("shows an introducer whose terminator is too far away", () => {
    const text = `${START}${"a".repeat(120)}${END}`;

    expect(new SetupMarkerFilter().feed(text).text).toBe(
      `${START}${"a".repeat(120)}${END}`,
    );
  });
});
