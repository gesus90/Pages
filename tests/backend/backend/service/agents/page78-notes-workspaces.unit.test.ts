import { beforeEach, expect, it, vi } from "vitest";

import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";

import { memoryFilesystem } from "./memory-filesystem";

vi.mock("node:fs/promises", async () =>
  (await import("./memory-filesystem")).memoryFilesystemModule(),
);

const AGENTS = "/home/service/.pages/Agents";
const paths = new AgentWorkspacePath({
  roots: ["/"],
  protectedDirectory: "/instance/data",
  additionalProtectedDirectories: [AGENTS],
});

beforeEach(() => {
  memoryFilesystem.reset();
  memoryFilesystem.addDirectory("/instance/data");
  memoryFilesystem.addDirectory(`${AGENTS}/plan/run`);
});

it("refuses registration of protected folders, descendants, ancestors and symlink aliases", async () => {
  memoryFilesystem.addLink("/alias", AGENTS);
  for (const directory of [
    AGENTS,
    `${AGENTS}/plan/run`,
    "/home/service",
    "/alias",
  ])
    await expect(paths.inspect(directory)).rejects.toMatchObject({
      code: "workspace_path_outside_roots",
    });
});

it("rechecks existing registrations after a path or protected ancestor is redirected", async () => {
  memoryFilesystem.addDirectory("/work/repo");
  const registration = await paths.inspect("/work/repo");
  memoryFilesystem.removeDirectory("/work/repo");
  memoryFilesystem.addLink("/work/repo", `${AGENTS}/plan/run`);
  await expect(
    paths.resolve({
      path: registration.path,
      directoryIdentity: registration.identity,
    }),
  ).rejects.toMatchObject({ code: "workspace_path_outside_roots" });
});

it("resolves symlinks in existing ancestors even before the protected directory exists", async () => {
  memoryFilesystem.removeDirectory("/home/service/.pages");
  memoryFilesystem.addDirectory("/storage/pages");
  memoryFilesystem.addLink("/home/service/.pages", "/storage/pages");
  await expect(paths.inspect("/storage")).rejects.toMatchObject({
    code: "workspace_path_outside_roots",
  });
});
