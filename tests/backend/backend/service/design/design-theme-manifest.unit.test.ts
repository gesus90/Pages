import { describe, expect, it } from "vitest";

import { parseDesignThemeManifest } from "@/backend/service/design/DesignThemeManifest";

const manifest = {
  schemaVersion: 1,
  id: "ocean",
  name: { de: " Meer ", en: " Ocean " },
  description: { de: "Blau", en: "Blue" },
  modes: ["light"],
};

describe("design theme manifest", () => {
  it("trims text and fills optional defaults", () => {
    expect(parseDesignThemeManifest(manifest, "ocean")).toEqual({
      manifest: {
        id: "ocean",
        name: { de: "Meer", en: "Ocean" },
        description: { de: "Blau", en: "Blue" },
        modes: ["light"],
        colors: {},
        materials: {},
        preview: null,
      },
    });
  });

  it("rejects invalid schema, identifiers and unmatched directory or modes", () => {
    for (const value of [
      { ...manifest, schemaVersion: 2 },
      { ...manifest, modes: ["light", "light"] },
      { ...manifest, preview: "../secret.png" },
      { ...manifest, colors: { light: { unknown: "#fff" } } },
      { ...manifest, colors: { light: { background: "not-a-color" } } },
    ]) {
      expect(parseDesignThemeManifest(value, "ocean")).toHaveProperty(
        "problems",
      );
    }
    expect(
      parseDesignThemeManifest({ ...manifest, id: "Bad" }, "Bad"),
    ).toHaveProperty("problems");
    expect(parseDesignThemeManifest(manifest, "other")).toHaveProperty(
      "problems",
    );
    expect(
      parseDesignThemeManifest({ ...manifest, colors: { dark: {} } }, "ocean"),
    ).toHaveProperty("problems");
  });
});
