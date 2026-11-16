import {
  STORAGE_MY_DRIVE_ID,
  STORAGE_SHARED_DRIVES_ID,
} from "@/definition/GoogleDriveStorage";

import { storageFolderHref } from "./storage-format";

import type {
  StorageFolderView,
  StorageItem,
  StoragePathEntry,
} from "@/definition/GoogleDriveStorage";

/** The step a row adds to the path of the folder that lists it. */
interface StorageFolderStep {
  readonly id: string;
  readonly name: string;
  /** The folder that lists the row; the step only fits a path that ends there. */
  readonly parentId: string;
}

/** What the link of a folder row tells the opened folder before Drive answers. */
export interface StorageFolderLinkState {
  readonly storageFolderStep: StorageFolderStep;
}

/** What a link that opens a folder from the list needs. */
export interface StorageFolderLink {
  readonly to: string;
  readonly state: StorageFolderLinkState;
}

const MY_DRIVE_STEP: StoragePathEntry = {
  id: STORAGE_MY_DRIVE_ID,
  name: "",
  role: "my_drive",
};

const SHARED_DRIVES_STEP: StoragePathEntry = {
  id: STORAGE_SHARED_DRIVES_ID,
  name: "",
  role: "shared_drives",
};

/** The path step of a root a link names by a fixed identifier, or `null`. */
function rootStepOf(folderId: string): StoragePathEntry | null {
  if (folderId === STORAGE_MY_DRIVE_ID) return MY_DRIVE_STEP;
  if (folderId === STORAGE_SHARED_DRIVES_ID) return SHARED_DRIVES_STEP;

  return null;
}

/**
 * The link that opens a folder from the list.
 * @param item - The folder row.
 * @param parentId - The folder that lists the row.
 * @returns The address, and the state that lets the path name the folder at the click.
 */
export function storageFolderLink(
  item: StorageItem,
  parentId: string,
): StorageFolderLink {
  return {
    state: { storageFolderStep: { id: item.id, name: item.name, parentId } },
    to: storageFolderHref(item.id),
  };
}

function readFolderStep(state: unknown): StorageFolderStep | null {
  if (
    typeof state !== "object" ||
    state === null ||
    !("storageFolderStep" in state)
  ) {
    return null;
  }

  const step: unknown = state.storageFolderStep;

  if (
    typeof step === "object" &&
    step !== null &&
    "id" in step &&
    "name" in step &&
    "parentId" in step &&
    typeof step.id === "string" &&
    typeof step.name === "string" &&
    typeof step.parentId === "string"
  ) {
    return { id: step.id, name: step.name, parentId: step.parentId };
  }

  return null;
}

/** The step of the shown path a folder of the address is, or `-1`. */
function indexOfTarget(
  path: readonly StoragePathEntry[],
  folderId: string,
): number {
  const rootRole = rootStepOf(folderId)?.role;

  return path.findIndex(
    (entry) =>
      entry.role !== "detached" &&
      (entry.id === folderId || entry.role === rootRole),
  );
}

/** What the path of a folder change is made from. */
interface PendingPathInput {
  /** The folder that stays in place until Drive answers; `null` before any was shown. */
  readonly previous: StorageFolderView | null;
  /** The folder of the address; `null` for the start folder. */
  readonly folderId: string | null;
  /** The history state of the address. */
  readonly state: unknown;
}

/**
 * The path of the folder an address asks for, known before Drive answers.
 * @param input - The shown folder, the asked folder and the history state.
 * @returns The path of the asked folder when it follows from the shown path (a
 * step of it, a root, or the row that was opened), else the shown path.
 */
export function pendingFolderPath(
  input: PendingPathInput,
): readonly StoragePathEntry[] {
  const { previous, folderId, state } = input;
  const path = previous?.path ?? [];

  if (previous === null || folderId === null) return path;

  const index = indexOfTarget(path, folderId);

  if (index >= 0) return path.slice(0, index + 1);

  const root = rootStepOf(folderId);

  if (root !== null) return [root];

  const step = readFolderStep(state);

  if (step?.id === folderId && step.parentId === previous.folderId) {
    return [...path, { id: step.id, name: step.name, role: "folder" }];
  }

  return path;
}
