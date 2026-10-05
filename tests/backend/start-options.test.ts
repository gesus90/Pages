import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseStartOptions,
  START_USAGE,
  StartOptionsError,
} from "@/backend/config/StartOptions";

describe("parseStartOptions", () => {
  it("returns no overrides without parameters", () => {
    expect(parseStartOptions([])).toEqual({ configPath: null, port: null });
  });

  it("reads both parameters in either spelling", () => {
    expect(parseStartOptions(["--port", "4000", "--config=conf.toml"])).toEqual(
      { configPath: path.resolve("conf.toml"), port: 4000 },
    );
    expect(
      parseStartOptions(["--config", "/etc/pages.toml", "--port=8080"]),
    ).toEqual({ configPath: "/etc/pages.toml", port: 8080 });
  });

  it("lets a later parameter win", () => {
    expect(parseStartOptions(["--port", "1", "--port", "2"]).port).toBe(2);
  });

  it.each([
    [["--port", "abc"], '"abc" is no valid port'],
    [["--port", "0"], '"0" is no valid port'],
    [["--port", "70000"], '"70000" is no valid port'],
    [["--port=-1"], '"-1" is no valid port'],
    [["--port"], "--port needs a value."],
    [["--config", " "], "--config needs a file path."],
    [["--host", "x"], 'Unknown start parameter "--host".'],
    [["serve"], 'Unknown start parameter "serve".'],
  ])("rejects %j", (argumentList, message) => {
    expect(() => parseStartOptions(argumentList)).toThrow(StartOptionsError);
    expect(() => parseStartOptions(argumentList)).toThrow(message);
  });

  it("explains the parameters", () => {
    expect(START_USAGE).toContain("--port <number>");
    expect(START_USAGE).toContain("--config <path>");
  });
});
