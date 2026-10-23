import { describe, expect, it } from "vitest";

import {
  ConfigError,
  readPagesConfig,
  writePagesConfig,
} from "@/backend/config/PagesConfig";

const SOURCE = "/srv/pages/config.toml";

describe("picaMobilePort", () => {
  it("is off by default", () => {
    expect(
      readPagesConfig({ firstRun: true }, SOURCE).picaMobilePort,
    ).toBeUndefined();
  });

  it("is read from a pending and from a finished setup", () => {
    expect(
      readPagesConfig({ firstRun: true, picaMobilePort: 3001 }, SOURCE)
        .picaMobilePort,
    ).toBe(3001);
    expect(
      readPagesConfig(
        {
          firstRun: false,
          databasePath: "/srv/pages/pages.duckdb",
          picaMobilePort: 65_535,
        },
        SOURCE,
      ).picaMobilePort,
    ).toBe(65_535);
  });

  it.each([0, 65_536, 1.5, -3, "3001", true])(
    "rejects the value %j",
    (value) => {
      expect(() =>
        readPagesConfig({ firstRun: true, picaMobilePort: value }, SOURCE),
      ).toThrow(ConfigError);
    },
  );

  it("is written back and omitted when unset", () => {
    const config = readPagesConfig(
      { firstRun: true, picaMobilePort: 3001, custom: "kept" },
      SOURCE,
    );

    expect(writePagesConfig({ custom: "kept" }, config)).toMatchObject({
      picaMobilePort: 3001,
      custom: "kept",
    });
    expect(
      writePagesConfig({}, readPagesConfig({ firstRun: true }, SOURCE)),
    ).not.toHaveProperty("picaMobilePort");
  });
});
