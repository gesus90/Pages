import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";

import { memoryFilesystem } from "./memory-filesystem";

vi.mock("node:fs/promises", async () => {
  const { memoryFilesystemModule } = await import("./memory-filesystem");
  return memoryFilesystemModule();
});

const DATA_DIRECTORY = "/srv/pages/data";
const AGENTS_DIRECTORY = "/srv/pages/agents";

function everywhere(): AgentWorkspacePath {
  return new AgentWorkspacePath({
    roots: ["/"],
    startDirectory: "/home/pages",
    protectedDirectory: DATA_DIRECTORY,
    additionalProtectedDirectories: [AGENTS_DIRECTORY],
  });
}

beforeEach(() => {
  memoryFilesystem.reset();
  memoryFilesystem.addDirectory(DATA_DIRECTORY);
  memoryFilesystem.addDirectory(AGENTS_DIRECTORY);
  memoryFilesystem.addDirectory("/home/pages/repo-b");
  memoryFilesystem.addDirectory("/home/pages/repo-a");
  memoryFilesystem.addDirectory("/home/pages/.cache");
  memoryFilesystem.addFile("/home/pages/notes.txt");
});

describe("without a configured root", () => {
  it("opens at the start directory, lists directories only and sorts them", async () => {
    const listing = await everywhere().browse({
      path: null,
      showHidden: false,
    });

    expect(listing.path).toBe("/home/pages");
    expect(listing.folders.map(({ name }) => name)).toEqual([
      "repo-a",
      "repo-b",
    ]);
    expect(listing.breadcrumbs.map(({ path }) => path)).toEqual([
      "/",
      "/home",
      "/home/pages",
    ]);
    expect(listing.hasSeveralRoots).toBe(false);
    expect(listing.selectionIssue).toBeNull();
  });

  it("shows hidden directories only when asked to", async () => {
    const listing = await everywhere().browse({ path: null, showHidden: true });

    expect(listing.folders.map(({ name }) => name)).toContain(".cache");
  });

  it("lets the way lead up to the filesystem root, which cannot be chosen", async () => {
    const listing = await everywhere().browse({ path: "/", showHidden: false });

    expect(listing.path).toBe("/");
    expect(listing.folders.map(({ name }) => name)).toContain("home");
    expect(listing.selectionIssue).toBe("workspace_path_invalid");
  });

  it("does not offer the instance folders and names the level that holds them", async () => {
    const listing = await everywhere().browse({
      path: "/srv/pages",
      showHidden: false,
    });

    expect(listing.folders).toEqual([]);
    expect(listing.selectionIssue).toBe("workspace_path_contains_instance");
  });

  it("refuses a level inside the instance folders", async () => {
    await expect(
      everywhere().browse({ path: DATA_DIRECTORY, showHidden: false }),
    ).rejects.toMatchObject({ code: "workspace_path_outside_roots" });
  });

  it("falls back to the first root when the start directory is gone", async () => {
    memoryFilesystem.removeDirectory("/home/pages");

    const listing = await everywhere().browse({
      path: null,
      showHidden: false,
    });

    expect(listing.path).toBe("/");
  });

  it("refuses a network location and a directory the account may not open", async () => {
    memoryFilesystem.deny("/home/pages/repo-a");

    await expect(
      everywhere().browse({ path: "//server/share", showHidden: false }),
    ).rejects.toMatchObject({ code: "workspace_path_invalid" });
    await expect(
      everywhere().browse({ path: "/home/pages/repo-a", showHidden: false }),
    ).rejects.toMatchObject({ code: "workspace_path_denied" });
  });
});

describe("with roots an operator configured", () => {
  function narrowed(): AgentWorkspacePath {
    return new AgentWorkspacePath({
      roots: ["/home/pages"],
      protectedDirectory: DATA_DIRECTORY,
    });
  }

  it("starts at the first root and stays within the roots", async () => {
    const listing = await narrowed().browse({ path: null, showHidden: false });

    expect(listing.path).toBe("/home/pages");
    await expect(
      narrowed().browse({ path: "/", showHidden: false }),
    ).rejects.toMatchObject({ code: "workspace_path_outside_roots" });
  });

  it("refuses a registration outside the roots", async () => {
    memoryFilesystem.addDirectory("/work/repo");

    await expect(narrowed().inspect("/work/repo")).rejects.toMatchObject({
      code: "workspace_path_outside_roots",
    });
    await expect(
      narrowed().inspect("/home/pages/repo-a"),
    ).resolves.toMatchObject({ path: "/home/pages/repo-a" });
  });
});
