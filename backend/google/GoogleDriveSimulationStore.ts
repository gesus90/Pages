import { DRIVE_FOLDER_MIME_TYPE } from "@/backend/google/GoogleDriveFormats";
import {
  createSimulationSeed,
  SIMULATED_ROOT_ID,
} from "@/backend/google/GoogleDriveSimulationSeed";

import type { SimulatedQueryClause } from "@/backend/google/GoogleDriveSimulationQuery";
import type {
  SimulatedDrive,
  SimulatedFile,
} from "@/backend/google/GoogleDriveSimulationSeed";

/** A folder chain deeper than this is treated as broken. */
const MAXIMUM_DEPTH = 100;

/** What a new entry consists of. */
export interface SimulatedFileInput {
  readonly name: string;
  readonly mimeType: string;
  readonly parentId: string;
  readonly content: Buffer | null;
}

function matchesClause(
  file: SimulatedFile,
  clause: SimulatedQueryClause,
  isTrashed: boolean,
): boolean {
  switch (clause.kind) {
    case "in_parents":
      return file.parents.includes(clause.id);
    case "trashed":
      return isTrashed === clause.isTrashed;
    case "mime_type":
      return (file.mimeType === clause.mimeType) !== clause.isNegated;
    case "name_equals":
      return file.name === clause.name;
    case "name_contains":
      return file.name.toLowerCase().includes(clause.text.toLowerCase());
    case "full_text":
      return (
        file.name.toLowerCase().includes(clause.text.toLowerCase()) ||
        (file.content?.toString("utf8").toLowerCase() ?? "").includes(
          clause.text.toLowerCase(),
        )
      );
  }
}

function compareFiles(left: SimulatedFile, right: SimulatedFile): number {
  const leftIsFolder = left.mimeType === DRIVE_FOLDER_MIME_TYPE;
  const rightIsFolder = right.mimeType === DRIVE_FOLDER_MIME_TYPE;

  if (leftIsFolder !== rightIsFolder) {
    return leftIsFolder ? -1 : 1;
  }

  return left.name.localeCompare(right.name, "de", {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * The in-memory content of the simulated Google Drive (PAGE-270).
 *
 * @remarks
 * It follows Drive's rules that matter to Pages: names need not be unique in
 * a folder, an entry in the trash takes its descendants with it, a restored
 * entry brings them back, and a deleted folder removes its whole tree. Every
 * change raises `version` and, for content and names, `modifiedTime`.
 */
export class GoogleDriveSimulationStore {
  private readonly files = new Map<string, SimulatedFile>();
  private readonly drives: readonly SimulatedDrive[];
  private sequence = 0;

  /** Creates the store in its starting state. */
  public constructor() {
    const seed = createSimulationSeed();

    for (const file of seed.files) {
      this.files.set(file.id, file);
    }

    this.drives = seed.drives;
  }

  /**
   * Finds an entry; `root` is the alias of the My Drive root.
   *
   * @param id - Drive identifier or `root`.
   * @returns The entry, or `null`.
   */
  public find(id: string): SimulatedFile | null {
    return this.files.get(id === "root" ? SIMULATED_ROOT_ID : id) ?? null;
  }

  /**
   * Tells whether an entry or one of its ancestors is in the trash.
   *
   * @param file - The entry.
   * @returns Whether Drive reports it as `trashed`.
   */
  public isTrashed(file: SimulatedFile): boolean {
    let current: SimulatedFile | null = file;

    for (let depth = 0; current && depth < MAXIMUM_DEPTH; depth += 1) {
      if (current.isExplicitlyTrashed) {
        return true;
      }

      const parentId: string | undefined = current.parents[0];

      current = parentId === undefined ? null : this.find(parentId);
    }

    return false;
  }

  /**
   * Tells whether an entry lies below a folder.
   *
   * @param file - The entry.
   * @param ancestorId - The folder.
   * @returns Whether the folder is the entry itself or one of its ancestors.
   */
  public isWithin(file: SimulatedFile, ancestorId: string): boolean {
    let current: SimulatedFile | null = file;

    for (let depth = 0; current && depth < MAXIMUM_DEPTH; depth += 1) {
      if (current.id === ancestorId) {
        return true;
      }

      const parentId: string | undefined = current.parents[0];

      current = parentId === undefined ? null : this.find(parentId);
    }

    return false;
  }

  /**
   * Searches entries, folders first and by natural name order.
   *
   * @param clauses - The conditions of the query.
   * @param driveId - Restricts the search to one shared drive.
   * @returns The matching entries; roots are never part of a search.
   */
  public search(
    clauses: readonly SimulatedQueryClause[],
    driveId: string | null,
  ): SimulatedFile[] {
    const matches: SimulatedFile[] = [];

    for (const file of this.files.values()) {
      if (file.parents.length === 0) {
        continue;
      }

      if (driveId !== null && file.driveId !== driveId) {
        continue;
      }

      const isTrashed = this.isTrashed(file);

      if (clauses.every((clause) => matchesClause(file, clause, isTrashed))) {
        matches.push(file);
      }
    }

    return matches.sort(compareFiles);
  }

  /**
   * Lists the shared drives.
   *
   * @returns Every shared drive of the simulated account.
   */
  public listDrives(): readonly SimulatedDrive[] {
    return this.drives;
  }

  /**
   * Finds a shared drive.
   *
   * @param id - Its identifier.
   * @returns The shared drive, or `null`.
   */
  public findDrive(id: string): SimulatedDrive | null {
    return this.drives.find((drive) => drive.id === id) ?? null;
  }

  /**
   * Adds an entry below a folder.
   *
   * @param input - Name, type, parent and bytes.
   * @returns The new entry.
   */
  public create(input: SimulatedFileInput): SimulatedFile {
    const parent = this.find(input.parentId);
    const now = new Date().toISOString();

    this.sequence += 1;

    const file: SimulatedFile = {
      content: input.content,
      createdTime: now,
      driveId: parent?.driveId ?? null,
      id: `sim-new-${Date.now().toString(36)}-${this.sequence}`,
      isExplicitlyTrashed: false,
      mimeType: input.mimeType,
      modifiedTime: now,
      name: input.name,
      parents: parent ? [parent.id] : [SIMULATED_ROOT_ID],
      version: 1,
      virtualSize: null,
    };

    this.files.set(file.id, file);

    return file;
  }

  /**
   * Records a change of an entry.
   *
   * @param file - The changed entry.
   * @param isVisibleChange - Whether name or content changed, which moves `modifiedTime`.
   */
  public touch(file: SimulatedFile, isVisibleChange: boolean): void {
    file.version += 1;

    if (isVisibleChange) {
      file.modifiedTime = new Date().toISOString();
    }
  }

  /**
   * Moves an entry and its tree into the shared drive of a new parent.
   *
   * @param file - The moved entry.
   * @param parentId - The new parent.
   */
  public move(file: SimulatedFile, parentId: string): void {
    const parent = this.find(parentId);
    const driveId = parent?.driveId ?? null;

    file.parents = [parent?.id ?? SIMULATED_ROOT_ID];

    for (const entry of this.files.values()) {
      if (this.isWithin(entry, file.id)) {
        entry.driveId = driveId;
      }
    }
  }

  /**
   * Removes an entry and, for a folder, its whole tree.
   *
   * @param file - The removed entry.
   */
  public remove(file: SimulatedFile): void {
    const removed = [...this.files.values()].filter((entry) =>
      this.isWithin(entry, file.id),
    );

    for (const entry of removed) {
      this.files.delete(entry.id);
    }
  }

  /**
   * Sums the bytes of all files.
   *
   * @returns Bytes in use and the part of them in the trash.
   */
  public usage(): { readonly usage: number; readonly trash: number } {
    let usage = 0;
    let trash = 0;

    for (const file of this.files.values()) {
      const size = file.virtualSize ?? file.content?.length ?? 0;

      usage += size;
      trash += this.isTrashed(file) ? size : 0;
    }

    return { trash, usage };
  }
}
