import { expect, it, vi } from "vitest";

import { readDeploymentBuild } from "@/backend/service/system/DeploymentBuild";

const BUILD = {
  commit: "281a48950123456789abcdef0123456789abcdef01",
  builtAt: "2026-11-13T10:12:00+01:00",
};

it("reads the deployment manifest and exposes only commit and builtAt", async () => {
  const readText = vi.fn(async () =>
    JSON.stringify({ ...BUILD, internalDeploymentPath: "/private/deploy" }),
  );

  await expect(readDeploymentBuild(readText)).resolves.toEqual(BUILD);
  expect(readText).toHaveBeenCalledExactlyOnceWith(
    expect.stringMatching(/\/deployment\.json$/u),
  );
});

it.each([
  null,
  "",
  "{broken",
  "null",
  "[]",
  "42",
  JSON.stringify({ commit: BUILD.commit }),
  JSON.stringify({ builtAt: BUILD.builtAt }),
  JSON.stringify({ ...BUILD, commit: 123 }),
  JSON.stringify({ ...BUILD, commit: "not-a-commit" }),
  JSON.stringify({ ...BUILD, commit: "281a489" }),
  JSON.stringify({ ...BUILD, builtAt: "not-a-date" }),
  JSON.stringify({ ...BUILD, builtAt: "2026-11-13T10:12:00" }),
])("returns unknown metadata without failing for %j", async (text) => {
  await expect(readDeploymentBuild(async () => text)).resolves.toBeNull();
});

it("recovers when reading the deployment file rejects", async () => {
  const readText = vi.fn().mockRejectedValue(new Error("Permission denied"));

  await expect(readDeploymentBuild(readText)).resolves.toBeNull();
});
