import { expect, it, vi } from "vitest";

import { DRIVE_FOLDER_MIME_TYPE } from "./GoogleDriveFormats";
import {
  SIMULATED_ROOT_ID,
  SIMULATED_SHARED_DRIVE_ID,
  createSimulationSeed,
} from "./GoogleDriveSimulationSeed";
import { GoogleDriveSimulationStore } from "./GoogleDriveSimulationStore";

it("creates fresh deterministic seed trees with paging and a shared drive", () => {
  const first = createSimulationSeed();
  const second = createSimulationSeed();
  expect(first).toEqual(second);
  expect(
    first.files.filter((file) => file.parents.includes("sim-many")),
  ).toHaveLength(230);
  expect(first.drives).toEqual([
    { id: SIMULATED_SHARED_DRIVE_ID, name: "Team-Ablage" },
  ]);
  expect(first.files[0]).not.toBe(second.files[0]);
});

it("searches the seed, including inherited trash and shared-drive restrictions", () => {
  const store = new GoogleDriveSimulationStore();
  const child = store.find("sim-trashed-child");
  expect(child).not.toBeNull();
  if (child === null) throw new Error("Missing simulated child");
  expect(store.find("root")?.id).toBe(SIMULATED_ROOT_ID);
  expect(store.find("missing")).toBeNull();
  expect(store.isTrashed(child)).toBe(true);
  expect(store.isWithin(child, "sim-trashed-folder")).toBe(true);
  expect(store.isWithin(child, "missing")).toBe(false);
  expect(store.findDrive(SIMULATED_SHARED_DRIVE_ID)).toEqual(
    store.listDrives()[0],
  );
  expect(store.findDrive("missing")).toBeNull();
  expect(
    store
      .search([{ kind: "in_parents", id: "sim-conflicts" }], null)
      .map((file) => file.id),
  ).toEqual(["sim-twin-folder", "sim-twin-a", "sim-twin-b"]);
  expect(
    store
      .search(
        [
          { kind: "trashed", isTrashed: true },
          { kind: "name_contains", text: "INHALT" },
        ],
        null,
      )
      .map((file) => file.id),
  ).toEqual(["sim-trashed-child"]);
  expect(
    store
      .search(
        [{ kind: "name_equals", name: "plan.txt" }],
        SIMULATED_SHARED_DRIVE_ID,
      )
      .map((file) => file.id),
  ).toEqual(["sim-team-plan"]);
  expect(
    store
      .search(
        [{ kind: "full_text", text: "TEAMPLAN" }],
        SIMULATED_SHARED_DRIVE_ID,
      )
      .map((file) => file.id),
  ).toEqual(["sim-team-plan"]);
  expect(
    store.search(
      [
        {
          kind: "mime_type",
          mimeType: DRIVE_FOLDER_MIME_TYPE,
          isNegated: true,
        },
        { kind: "in_parents", id: "sim-conflicts" },
      ],
      null,
    ),
  ).toHaveLength(2);
  const { usage, trash } = store.usage();
  expect(trash).toBeGreaterThan(0);
  expect(usage).toBeGreaterThan(300 * 1024 * 1024);
  expect(usage).toBeGreaterThan(trash);
});

it("creates, moves, updates and removes trees without affecting another store", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    const store = new GoogleDriveSimulationStore();
    const folder = store.create({
      name: "folder",
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parentId: "root",
      content: null,
    });
    const child = store.create({
      name: "note",
      mimeType: "text/plain",
      parentId: folder.id,
      content: Buffer.from("hello"),
    });
    const fallback = store.create({
      name: "fallback",
      mimeType: "text/plain",
      parentId: "missing",
      content: null,
    });
    expect(fallback.parents).toEqual([SIMULATED_ROOT_ID]);
    expect(child.driveId).toBeNull();
    store.move(folder, SIMULATED_SHARED_DRIVE_ID);
    expect(child.driveId).toBe(SIMULATED_SHARED_DRIVE_ID);
    expect(store.isWithin(child, SIMULATED_SHARED_DRIVE_ID)).toBe(true);
    vi.setSystemTime(new Date("2026-02-02T00:00:00Z"));
    store.touch(child, false);
    expect(child.modifiedTime).toBe("2026-02-01T00:00:00.000Z");
    store.touch(child, true);
    expect(child).toMatchObject({
      version: 3,
      modifiedTime: "2026-02-02T00:00:00.000Z",
    });
    store.remove(folder);
    expect(store.find(child.id)).toBeNull();
    expect(new GoogleDriveSimulationStore().find(child.id)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("falls back to the root when moving to a missing parent", () => {
  const store = new GoogleDriveSimulationStore();
  const file = store.find("sim-team-plan");
  if (file === null) throw new Error("Missing simulated file");
  store.move(file, "missing");
  expect(file.parents).toEqual([SIMULATED_ROOT_ID]);
  expect(file.driveId).toBeNull();
});

it("sorts a newly created folder before files regardless of insertion order", () => {
  const store = new GoogleDriveSimulationStore();
  const file = store.create({
    name: "file",
    mimeType: "text/plain",
    parentId: "root",
    content: null,
  });
  const folder = store.create({
    name: "folder",
    mimeType: DRIVE_FOLDER_MIME_TYPE,
    parentId: "root",
    content: null,
  });
  const results = store.search(
    [{ kind: "in_parents", id: SIMULATED_ROOT_ID }],
    null,
  );
  expect(results.indexOf(folder)).toBeLessThan(results.indexOf(file));
});
