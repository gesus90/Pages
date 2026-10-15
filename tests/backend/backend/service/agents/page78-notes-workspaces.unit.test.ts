import { beforeEach, expect, it, vi } from "vitest";

import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";

import { memoryFilesystem } from "./memory-filesystem";

vi.mock("node:fs/promises", async () =>
  (await import("./memory-filesystem")).memoryFilesystemModule(),
);

const TEMP = "/home/service/.pages/temp";
const paths = new AgentWorkspacePath({
  roots: ["/"],
  protectedDirectory: "/instance/data",
  additionalProtectedDirectories: [TEMP],
});

beforeEach(() => {
  memoryFilesystem.reset();
  memoryFilesystem.addDirectory("/instance/data");
  memoryFilesystem.addDirectory(`${TEMP}/plan/run`);
});

it("refuses registration of temp, descendants, ancestors and symlink aliases", async () => {
  memoryFilesystem.addLink("/alias", TEMP);
  for (const directory of [TEMP, `${TEMP}/plan/run`, "/home/service", "/alias"])
    await expect(paths.inspect(directory)).rejects.toMatchObject({
      code: "workspace_path_outside_roots",
    });
});

it("rechecks existing registrations after a path or protected ancestor is redirected", async () => {
  memoryFilesystem.addDirectory("/work/repo");
  const registration = await paths.inspect("/work/repo");
  memoryFilesystem.removeDirectory("/work/repo");
  memoryFilesystem.addLink("/work/repo", `${TEMP}/plan/run`);
  await expect(
    paths.resolve({
      path: registration.path,
      directoryIdentity: registration.identity,
    }),
  ).rejects.toMatchObject({ code: "workspace_path_outside_roots" });
});

it("resolves symlinks in existing ancestors even before the temp directory exists", async () => {
  memoryFilesystem.removeDirectory("/home/service/.pages");
  memoryFilesystem.addDirectory("/storage/pages");
  memoryFilesystem.addLink("/home/service/.pages", "/storage/pages");
  await expect(paths.inspect("/storage")).rejects.toMatchObject({
    code: "workspace_path_outside_roots",
  });
});
