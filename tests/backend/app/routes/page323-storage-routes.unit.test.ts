import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import {
  action as saveStart,
  loader as browse,
} from "@/app/routes/storage-api";
import { action as write, loader as read } from "@/app/routes/storage-api-v1";
import {
  action as configure,
  loader as settings,
} from "@/app/routes/storage-access-api";

import { storageWorld } from "../../backend/service/google/page323-storage-fixture";

import type { User } from "@/definition/User";

const wiring = vi.hoisted(() => ({ services: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: wiring.services,
}));
const ACTOR: User = {
  id: "Ed",
  username: "ed",
  displayName: "Ed",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
  isAgent: true,
};

function routeContext(): RouterContextProvider {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, ACTOR);
  return context;
}

function args(
  request: Request,
  operation = "list",
): Parameters<typeof write>[0] {
  return {
    context: routeContext(),
    request,
    params: { operation },
    url: new URL(request.url),
    pattern: "/storage-api/v1/:operation",
  };
}

function storageArgs(request: Request): Parameters<typeof browse>[0] {
  return {
    context: routeContext(),
    request,
    params: {},
    url: new URL(request.url),
    pattern: "/storage-api",
  };
}

function accessArgs(request: Request): Parameters<typeof configure>[0] {
  return {
    context: routeContext(),
    request,
    params: {},
    url: new URL(request.url),
    pattern: "/storage-api/access",
  };
}

beforeEach(() => wiring.services.mockReset());

it("UI storage routes allow a granted folder and reject unrelated folders and accounts without a grant", async () => {
  const world = storageWorld();
  wiring.services.mockResolvedValue({
    googleDriveFileService: world.files,
    storageAccessService: world.access,
    administrationService: { getContext: async () => world.account },
  });
  const create = (parentRef: string): Parameters<typeof write>[0] =>
    args(
      new Request("http://pages/storage-api/v1/create_folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentRef, name: "Report" }),
      }),
      "create_folder",
    );
  expect((await write(create("pages"))).status).toBe(200);
  expect((await write(create("private"))).status).toBe(403);
  expect(
    (
      await read(
        args(
          new Request("http://pages/storage-api/v1/capabilities?ref=private"),
          "capabilities",
        ),
      )
    ).status,
  ).toBe(403);
  const listing = await browse(
    storageArgs(new Request("http://pages/storage-api")),
  );
  expect(await listing.json()).toMatchObject({
    folder: { items: [{ id: "pages", name: "Pages" }] },
  });
  expect(
    (
      await browse(
        storageArgs(new Request("http://pages/storage-api?folder=private")),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await browse(
        storageArgs(new Request("http://pages/storage-api?view=quota")),
      )
    ).status,
  ).toBe(403);
  world.grants.splice(0);
  expect((await write(create("pages"))).status).toBe(403);
  expect(world.drive.calls.createFolder).toHaveBeenCalledTimes(1);
});

it("rejects non-administrators at grant configuration before resolving a path or writing grants", async () => {
  const world = storageWorld();
  wiring.services.mockResolvedValue({
    googleDriveFileService: world.files,
    storageAccessService: world.access,
  });
  const request = new Request("http://pages/storage-api/access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "/Storage/Pages",
      targetKind: "group",
      targetId: "a-team",
      enabled: true,
    }),
  });
  expect((await configure(accessArgs(request))).status).toBe(403);
  expect(
    (await settings(accessArgs(new Request("http://pages/storage-api/access"))))
      .status,
  ).toBe(403);
  expect(world.repository.setGrant).not.toHaveBeenCalled();
  expect(world.drive.calls.stat).not.toHaveBeenCalled();
});

it("configures a real folder grant from the settings and revokes it without replacing other grants", async () => {
  const world = storageWorld();
  world.readAccount.mockResolvedValue({
    ...world.account,
    isAdmin: true,
    isAgent: false,
    mode: "admin",
  });
  wiring.services.mockResolvedValue({
    googleDriveFileService: world.files,
    storageAccessService: world.access,
  });
  const request = (enabled: boolean): Request =>
    new Request("http://pages/storage-api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "/Pages",
        targetKind: "group",
        targetId: "a-team",
        enabled,
      }),
    });
  expect((await configure(accessArgs(request(true)))).status).toBe(200);
  expect(world.repository.setGrant).toHaveBeenLastCalledWith(
    expect.objectContaining({
      folderRef: "pages",
      targetId: "a-team",
      permissionId: "permission",
    }),
    true,
  );
  expect((await configure(accessArgs(request(false)))).status).toBe(200);
  expect(world.repository.setGrant).toHaveBeenLastCalledWith(
    expect.objectContaining({ folderRef: "pages", targetId: "a-team" }),
    false,
  );
});

it("rejects non-administrators at start-folder mutations in storage-api", async () => {
  const world = storageWorld();
  const clearStartFolder = vi.fn();
  const saveStartFolder = vi.fn();
  wiring.services.mockResolvedValue({
    googleDriveFileService: world.files,
    storageAccessService: world.access,
    googleDriveStorageService: { clearStartFolder, saveStartFolder },
    administrationService: { getContext: async () => world.account },
  });
  const response = await saveStart(
    storageArgs(
      new Request("http://pages/storage-api", {
        method: "POST",
        body: new URLSearchParams({ intent: "save-start", folderId: "pages" }),
      }),
    ),
  );
  expect(response.status).toBe(403);
  expect(clearStartFolder).not.toHaveBeenCalled();
  expect(saveStartFolder).not.toHaveBeenCalled();
});
