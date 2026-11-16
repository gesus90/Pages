import { expect, it } from "vitest";

import { DesignThemeRegistry } from "@/backend/service/design/DesignThemeRegistry";

it("always offers shipped designs when the configured directory is absent", async () => {
  const registry = new DesignThemeRegistry(
    `${process.cwd()}/tests/backend/nonexistent-themes-9f6e28`,
  );
  const catalog = await registry.list();
  expect(catalog.themes.map((theme) => theme.manifest.id)).toEqual([
    "standard",
    "arctic-ice",
    "jungle-botanical",
    "neural-rgb",
    "koi-garden",
  ]);
  expect(catalog.skipped).toEqual([]);
  expect(await registry.find("standard")).toMatchObject({
    manifest: { id: "standard" },
  });
});

it("rejects invalid or absent theme identifiers", async () => {
  const registry = new DesignThemeRegistry(
    `${process.cwd()}/tests/backend/nonexistent-themes-9f6e28`,
  );
  await expect(registry.find("../escape")).resolves.toBeNull();
  await expect(registry.find("missing-theme")).resolves.toBeNull();
});
