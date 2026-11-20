import { expect, it, vi } from "vitest";

import {
  GOOGLE_DRIVE_FULL_SCOPE,
  GOOGLE_DRIVE_READ_SCOPE,
} from "./GoogleDriveConfig";
import { GoogleDriveFilesClient } from "./GoogleDriveFilesClient";
import { GoogleDriveItemsClient } from "./GoogleDriveItemsClient";
import {
  GoogleDriveSimulation,
  SIMULATED_ACCOUNT,
} from "./GoogleDriveSimulation";
import { GoogleDriveSimulationStore } from "./GoogleDriveSimulationStore";

import type { GoogleDriveSimulationScenario } from "./GoogleDriveSimulationConfig";

function fixture(scenario: GoogleDriveSimulationScenario = "full"): {
  simulation: GoogleDriveSimulation;
  items: GoogleDriveItemsClient;
  files: GoogleDriveFilesClient;
  request: (path: string, init?: RequestInit) => Promise<Response>;
} {
  const simulation = new GoogleDriveSimulation(scenario);
  return {
    simulation,
    items: new GoogleDriveItemsClient(simulation.fetch),
    files: new GoogleDriveFilesClient(simulation.fetch),
    request: (path, init = {}) =>
      simulation.fetch(`https://www.googleapis.com${path}`, init),
  };
}

it("isolates scenarios, scopes and the allowed origin", async () => {
  const full = fixture();
  expect(full.simulation.grantedScopes()).toEqual([GOOGLE_DRIVE_FULL_SCOPE]);
  expect(fixture("read_only").simulation.grantedScopes()).toEqual([
    GOOGLE_DRIVE_READ_SCOPE,
  ]);
  await expect(
    full.simulation.fetch("https://other.example/drive/v3/about", {}),
  ).rejects.toThrow(TypeError);
  await expect(
    fixture("unreachable").simulation.fetch(
      "https://www.googleapis.com/drive/v3/about",
      {},
    ),
  ).rejects.toThrow(TypeError);
  await expect(
    fixture("read_only").items.createFolder("token", {
      name: "test",
      parentId: "root",
    }),
  ).resolves.toMatchObject({ ok: false, code: "provider_scope_missing" });
  await expect(
    fixture("item_forbidden").items.stat("token", "sim-locked-file"),
  ).resolves.toMatchObject({ ok: false, code: "provider_forbidden" });
});

it("reads account, quota and seeded folder metadata", async () => {
  const { request, files, items } = fixture();
  const about = await request("/drive/v3/about");
  const body: unknown = await about.json();
  expect(body).toMatchObject({
    user: SIMULATED_ACCOUNT,
    storageQuota: { limit: String(15 * 1024 ** 3) },
  });
  await expect(files.readFolder("token", "root")).resolves.toMatchObject({
    ok: true,
    value: { id: "sim-root", isFolder: true, parentId: null },
  });
  await expect(items.readQuota("token")).resolves.toMatchObject({
    ok: true,
    value: { limitBytes: 15 * 1024 ** 3 },
  });
  await expect(items.stat("token", "sim-team-plan")).resolves.toMatchObject({
    ok: true,
    value: { name: "plan.txt", driveRef: "sim-shared-team" },
  });
  await expect(items.stat("token", "missing")).resolves.toMatchObject({
    ok: false,
    code: "not_found",
  });
  expect((await request("/drive/v3/unknown")).status).toBe(404);
});

it("paginates lists and validates query and cursor input", async () => {
  const { items, request } = fixture();
  const first = await items.query("token", {
    query: "'sim-many' in parents and trashed = false",
    pageSize: 100,
    pageToken: null,
    driveId: null,
  });
  if (!first.ok) throw new Error("Expected first page");
  expect(first.value.entries).toHaveLength(100);
  expect(first.value.nextPageToken).toBe("sim-page-100");
  const last = await items.query("token", {
    query: "'sim-many' in parents and trashed = false",
    pageSize: 200,
    pageToken: first.value.nextPageToken,
    driveId: null,
  });
  if (!last.ok) throw new Error("Expected last page");
  expect(last.value.entries).toHaveLength(130);
  expect(last.value.nextPageToken).toBeNull();
  expect((await request("/drive/v3/files?q=invalid")).status).toBe(400);
  expect((await request("/drive/v3/files?pageToken=invalid")).status).toBe(400);
  expect((await request("/drive/v3/drives?pageToken=invalid")).status).toBe(
    400,
  );
  await expect(
    items.listSharedDrives("token", { pageSize: 10, pageToken: null }),
  ).resolves.toMatchObject({
    ok: true,
    value: { entries: [{ ref: "sim-shared-team" }] },
  });
  await expect(
    fixture().files.readSharedDriveName("token", "sim-shared-team"),
  ).resolves.toEqual({ ok: true, value: "Team-Ablage" });
  await expect(
    fixture().files.readSharedDriveName("token", "missing"),
  ).resolves.toMatchObject({ ok: false, folderProblem: "not_found" });
});

it("creates, moves, copies, trashes and removes entries in memory", async () => {
  const { items } = fixture();
  const folder = await items.createFolder("token", {
    name: "New folder",
    parentId: "root",
  });
  if (!folder.ok) throw new Error("Folder creation failed");
  const uploaded = await items.upload("token", {
    name: "hello.txt",
    mimeType: "text/plain",
    parentId: folder.value.ref,
    content: Buffer.from("hello"),
  });
  if (!uploaded.ok) throw new Error("Upload failed");
  expect(uploaded.value).toMatchObject({
    name: "hello.txt",
    parentRef: folder.value.ref,
    sizeBytes: 5,
  });
  const download = await items.download("token", uploaded.value.ref);
  if (!download.ok || !download.value.body) throw new Error("Download failed");
  expect(await new Response(download.value.body).text()).toBe("hello");
  await expect(
    items.replaceContent("token", uploaded.value.ref, {
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("changed"),
    }),
  ).resolves.toMatchObject({ ok: true, value: { sizeBytes: 7 } });
  await expect(
    items.change("token", uploaded.value.ref, {
      name: "renamed",
      isTrashed: true,
      addParentId: "root",
      removeParentId: folder.value.ref,
    }),
  ).resolves.toMatchObject({
    ok: true,
    value: { name: "renamed", isTrashed: true, parentRef: "sim-root" },
  });
  const copy = await items.copy("token", uploaded.value.ref, {
    name: "copy",
    parentId: folder.value.ref,
  });
  if (!copy.ok) throw new Error("Copy failed");
  expect(copy.value).toMatchObject({
    name: "copy",
    parentRef: folder.value.ref,
    isTrashed: false,
  });
  await expect(items.remove("token", folder.value.ref)).resolves.toEqual({
    ok: true,
    value: null,
  });
  await expect(items.stat("token", copy.value.ref)).resolves.toMatchObject({
    ok: false,
    code: "not_found",
  });
  await expect(items.remove("token", "root")).resolves.toMatchObject({
    ok: false,
    code: "provider_forbidden",
  });
  await expect(
    fixture().items.stat("token", uploaded.value.ref),
  ).resolves.toMatchObject({ ok: false, code: "not_found" });
});

it("exports documents and rejects unsupported file operations", async () => {
  const { items, request } = fixture();
  await expect(items.download("token", "sim-pages")).resolves.toMatchObject({
    ok: false,
    code: "unsupported_operation",
  });
  await expect(
    items.download("token", "sim-concept-doc"),
  ).resolves.toMatchObject({ ok: false, code: "unsupported_operation" });
  const exported = await items.export("token", "sim-concept-doc", "text/plain");
  if (!exported.ok || !exported.value.body) throw new Error("Export failed");
  expect(await new Response(exported.value.body).text()).toContain(
    "Konzept für Pages Storage",
  );
  await expect(
    items.export("token", "sim-readme", "text/plain"),
  ).resolves.toMatchObject({ ok: false, code: "unsupported_operation" });
  await expect(
    items.export("token", "sim-concept-doc", "application/unsupported"),
  ).resolves.toMatchObject({ ok: false, code: "unsupported_operation" });
  await expect(
    items.copy("token", "sim-pages", { name: "copy", parentId: "root" }),
  ).resolves.toMatchObject({ ok: false, code: "unsupported_operation" });
  await expect(
    items.replaceContent("token", "sim-pages", {
      mimeType: "text/plain",
      bytes: new Uint8Array(),
    }),
  ).resolves.toMatchObject({ ok: false, code: "unsupported_operation" });
  expect(
    (
      await request("/upload/drive/v3/files/sim-readme?uploadType=unknown", {
        method: "PATCH",
        body: "x",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request("/upload/drive/v3/files?uploadType=unknown", {
        method: "POST",
        body: "x",
      })
    ).status,
  ).toBe(400);
});

it("rejects invalid or inaccessible parents and cycles", async () => {
  const { items } = fixture();
  await expect(
    items.createFolder("token", { name: "bad", parentId: "missing" }),
  ).resolves.toMatchObject({ ok: false, code: "not_found" });
  await expect(
    items.createFolder("token", { name: "bad", parentId: "sim-readme" }),
  ).resolves.toMatchObject({ ok: false, code: "not_found" });
  await expect(
    items.change("token", "sim-projects", { addParentId: "sim-pages" }),
  ).resolves.toMatchObject({ ok: false, code: "invalid_request" });
  await expect(
    items.change("token", "sim-readme", {
      addParentId: "root",
      removeParentId: "wrong",
    }),
  ).resolves.toMatchObject({ ok: false, code: "invalid_request" });
  await expect(
    fixture("item_forbidden").items.createFolder("token", {
      name: "bad",
      parentId: "sim-locked-folder",
    }),
  ).resolves.toMatchObject({ ok: false, code: "provider_forbidden" });
});

it("uses default metadata for empty or malformed request bodies", async () => {
  const { request } = fixture();
  for (const body of [undefined, "{broken", "null", "[]"]) {
    const response = await request("/drive/v3/files", { method: "POST", body });
    const resource: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(resource).toMatchObject({
      name: "Untitled",
      mimeType: "application/octet-stream",
      parents: ["sim-root"],
    });
  }
  const copy = await request("/drive/v3/files/sim-readme/copy", {
    method: "POST",
  });
  const copied: unknown = await copy.json();
  expect(copied).toMatchObject({
    name: "Copy of README.txt",
    parents: ["sim-pages"],
  });
  expect(
    (
      await request("/drive/v3/files/sim-readme/copy", {
        method: "POST",
        body: JSON.stringify({ parents: ["missing"] }),
      })
    ).status,
  ).toBe(404);
});

it("honors shared-drive filters, paging limits and invalid export requests", async () => {
  const { request, items } = fixture();
  const listing = await items.query("token", {
    query: "'sim-team-common' in parents",
    pageSize: 5000,
    pageToken: null,
    driveId: "sim-shared-team",
  });
  if (!listing.ok) throw new Error("Shared drive listing failed");
  expect(listing.value.entries.map((entry) => entry.ref)).toEqual([
    "sim-team-plan",
  ]);
  const defaults = await request("/drive/v3/files?pageSize=0");
  const page: unknown = await defaults.json();
  expect(page).toMatchObject({ nextPageToken: "sim-page-100" });
  expect((await request("/drive/v3/files/sim-concept-doc/export")).status).toBe(
    400,
  );
});

it("handles metadata-only changes, invalid moves and upload parent errors", async () => {
  const { request, items } = fixture();
  await expect(
    items.change("token", "sim-readme", { isTrashed: true }),
  ).resolves.toMatchObject({
    ok: true,
    value: { isTrashed: true, name: "README.txt" },
  });
  await expect(
    items.change("token", "sim-readme", { removeParentId: "sim-pages" }),
  ).resolves.toMatchObject({ ok: false, code: "not_found" });
  expect(
    (
      await request("/drive/v3/files/sim-readme?addParents=root,sim-pages", {
        method: "PATCH",
        body: "{}",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request("/upload/drive/v3/files/sim-readme?uploadType=media", {
        method: "POST",
        body: "new",
      })
    ).status,
  ).toBe(403);
  const uploaded = await request("/upload/drive/v3/files?uploadType=media", {
    method: "POST",
    body: "new",
    headers: { "Content-Type": "text/plain" },
  });
  const resource: unknown = await uploaded.json();
  expect(resource).toMatchObject({
    name: "Untitled",
    mimeType: "text/plain",
    parents: ["sim-root"],
    size: "3",
  });
  await expect(
    items.upload("token", {
      name: "bad",
      parentId: "missing",
      mimeType: "text/plain",
      content: new Uint8Array(),
    }),
  ).resolves.toMatchObject({ ok: false, code: "not_found" });
});

it("defaults an omitted page size and preserves trash state on a rename", async () => {
  const { request, items } = fixture();
  const response = await request("/drive/v3/files");
  const listing: unknown = await response.json();
  expect(listing).toMatchObject({ nextPageToken: "sim-page-100" });
  await expect(
    items.change("token", "sim-readme", { name: "renamed.txt" }),
  ).resolves.toMatchObject({
    ok: true,
    value: { name: "renamed.txt", isTrashed: false, parentRef: "sim-pages" },
  });
});

it.each([
  "sim-page-",
  "sim-page--1",
  "sim-page-1.5",
  "sim-page-9007199254740992",
])("rejects malformed or out-of-range page token %s", async (token) => {
  const { request } = fixture();
  const query = new URLSearchParams({ pageToken: token });
  for (const endpoint of ["/drive/v3/files", "/drive/v3/drives"]) {
    const response = await request(`${endpoint}?${query.toString()}`);
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ error: { errors: [{ reason: "invalid" }] } });
  }
});

it("accepts zero and nonzero numeric cursors without skipping entries", async () => {
  const { items } = fixture();
  const query = { query: "'sim-many' in parents", pageSize: 2, driveId: null };
  const first = await items.query("token", { ...query, pageToken: null });
  const zero = await items.query("token", {
    ...query,
    pageToken: "sim-page-0",
  });
  const next = await items.query("token", {
    ...query,
    pageToken: "sim-page-2",
  });
  if (!first.ok || !zero.ok || !next.ok)
    throw new Error("Expected valid pages");
  expect(zero.value).toEqual(first.value);
  expect(first.value.entries.map((entry) => entry.ref)).toEqual([
    "sim-many-001",
    "sim-many-002",
  ]);
  expect(first.value.nextPageToken).toBe("sim-page-2");
  expect(next.value.entries.map((entry) => entry.ref)).toEqual([
    "sim-many-003",
    "sim-many-004",
  ]);
});

it("paginates multiple shared drives without losing or repeating entries", async () => {
  const drives = [
    { id: "drive-one", name: "One" },
    { id: "drive-two", name: "Two" },
    { id: "drive-three", name: "Three" },
  ];
  const list = vi
    .spyOn(GoogleDriveSimulationStore.prototype, "listDrives")
    .mockReturnValue(drives);
  try {
    const { items } = fixture();
    const first = await items.listSharedDrives("token", {
      pageSize: 2,
      pageToken: null,
    });
    if (!first.ok) throw new Error("First shared-drive page failed");
    expect(first.value.entries.map((entry) => entry.ref)).toEqual([
      "drive-one",
      "drive-two",
    ]);
    expect(first.value.nextPageToken).toBe("sim-page-2");
    const second = await items.listSharedDrives("token", {
      pageSize: 2,
      pageToken: first.value.nextPageToken,
    });
    if (!second.ok) throw new Error("Second shared-drive page failed");
    expect(second.value.entries.map((entry) => entry.ref)).toEqual([
      "drive-three",
    ]);
    expect(second.value.nextPageToken).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  } finally {
    list.mockRestore();
  }
});

it("copies virtual files and keeps the copy independent of later content changes", async () => {
  const { items } = fixture();
  const copied = await items.copy("token", "sim-large-video", {
    name: "copy.mp4",
    parentId: "root",
  });
  if (!copied.ok) throw new Error("Virtual file copy failed");
  expect(copied.value).toMatchObject({
    name: "copy.mp4",
    parentRef: "sim-root",
    sizeBytes: 300 * 1024 * 1024,
  });

  await expect(
    items.replaceContent("token", "sim-large-video", {
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("replacement"),
    }),
  ).resolves.toMatchObject({ ok: true, value: { sizeBytes: 11 } });
  await expect(items.stat("token", copied.value.ref)).resolves.toMatchObject({
    ok: true,
    value: { mimeType: "video/mp4", sizeBytes: 300 * 1024 * 1024 },
  });
  const original = await items.download("token", "sim-large-video");
  if (!original.ok || !original.value.body)
    throw new Error("Original download failed");
  expect(await new Response(original.value.body).text()).toBe("replacement");
});

it("rejects a parent change that only removes parents", async () => {
  const { request } = fixture();
  const response = await request(
    "/drive/v3/files/sim-readme?removeParents=sim-root",
    { method: "PATCH", body: "{}" },
  );

  expect(response.status).toBe(404);
});

it("rejects moving a file below a missing parent", async () => {
  const { request } = fixture();
  const response = await request(
    "/drive/v3/files/sim-readme?addParents=sim-missing",
    { method: "PATCH", body: "{}" },
  );

  expect(response.status).toBe(404);
});

it("copies a file that has lost its parents into the root", async () => {
  const { simulation, request } = fixture();
  const store: unknown = Reflect.get(simulation, "store");
  if (!(store instanceof GoogleDriveSimulationStore))
    throw new Error("The simulation holds no store");
  const file = store.find("sim-readme");
  if (!file) throw new Error("The seeded file is missing");
  file.parents = [];

  const response = await request("/drive/v3/files/sim-readme/copy", {
    method: "POST",
    body: "{}",
  });
  const resource: unknown = await response.json();

  expect(response.status).toBe(200);
  expect(resource).toMatchObject({ parents: ["sim-root"] });
});
