import { describe, expect, it } from "vitest";

import {
  USER,
  createConnection,
  createWriter,
  makeEntry,
} from "./storage-file-writer-harness";

import type { StorageFileWriter } from "@/backend/service/google/StorageFileWriter";
import type { StorageResult } from "@/definition/GoogleDriveFiles";

const OPERATIONS: readonly [
  string,
  (writer: StorageFileWriter) => Promise<StorageResult<unknown>>,
][] = [
  [
    "update",
    (writer) =>
      writer.update({
        bytes: new Uint8Array(1),
        confirmation: null,
        mimeType: "text/plain",
        ref: "docs",
        userId: USER,
      }),
  ],
  [
    "copy",
    (writer) =>
      writer.copy({
        name: null,
        onConflict: "fail",
        ref: "docs",
        targetParentRef: null,
        userId: USER,
      }),
  ],
  [
    "move",
    (writer) =>
      writer.move({
        onConflict: "fail",
        ref: "docs",
        targetParentRef: "root",
        userId: USER,
      }),
  ],
  [
    "rename",
    (writer) =>
      writer.rename({
        name: "Neu",
        onConflict: "fail",
        ref: "docs",
        userId: USER,
      }),
  ],
  [
    "trash",
    (writer) => writer.trash({ confirmation: null, ref: "docs", userId: USER }),
  ],
  ["restore", (writer) => writer.restore({ ref: "docs", userId: USER })],
  [
    "deletePermanently",
    (writer) =>
      writer.deletePermanently({
        confirmation: null,
        ref: "docs",
        userId: USER,
      }),
  ],
  [
    "confirm",
    (writer) => writer.confirm({ action: "delete", ref: "docs", userId: USER }),
  ],
];

describe("StorageFileWriter without a usable connection", () => {
  it.each(OPERATIONS)(
    "%s reports the connection state and touches no entry",
    async (operation, run) => {
      const { drive, writer } = createWriter(
        [makeEntry("docs", { isFolder: true })],
        createConnection({
          ok: false,
          problem: "scope_missing",
          state: "reauthorization_required",
        }),
      );

      expect(await run(writer)).toEqual({
        error: {
          code: "connection_unavailable",
          connectionProblem: "scope_missing",
          connectionState: "reauthorization_required",
        },
        ok: false,
      });
      expect(drive.calls.stat).not.toHaveBeenCalled();
      expect(drive.calls.change).not.toHaveBeenCalled();
      expect(drive.calls.remove).not.toHaveBeenCalled();
    },
  );
});
