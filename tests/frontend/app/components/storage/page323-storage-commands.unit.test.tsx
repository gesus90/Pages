import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { buildStorageCommands } from "@/app/components/storage/storage-commands";
import { useStorageActions } from "@/app/components/storage/use-storage-actions";
import { useStorageBatch } from "@/app/components/storage/use-storage-batch";
import { useStorageSelection } from "@/app/components/storage/use-storage-selection";

const ITEM = {
  id: "report",
  name: "report.md",
  isFolder: false,
  mimeType: "text/markdown",
  modifiedAt: null,
  sizeBytes: 1,
  webViewLink: null,
};

it("offers new folders to a granted account while keeping delete, move and rename disabled", () => {
  const noop = vi.fn();
  const hook = renderHook(() => {
    const actions = useStorageActions({
      parentRef: "pages",
      maxUploadBytes: 1000,
      onChanged: noop,
    });
    const batch = useStorageBatch({
      folderRef: "pages",
      onChanged: noop,
      onSelectionGone: noop,
    });
    const selection = useStorageSelection([ITEM], "pages");
    return buildStorageCommands({
      actions,
      batch,
      selection: { ...selection, items: [ITEM] },
      canWrite: true,
      folderRef: "pages",
      items: [ITEM],
      operations: ["create_folder", "upload", "update", "read", "list"],
    });
  });
  expect(
    hook.result.current.find((command) => command.id === "newFolder")
      ?.isDisabled,
  ).toBe(false);
  for (const id of ["move", "trash", "rename", "copy", "paste"])
    expect(
      hook.result.current.find((command) => command.id === id)?.isDisabled,
    ).toBe(true);
});

it("disables new folders without the write right even when the operation is advertised", () => {
  const noop = vi.fn();
  const hook = renderHook(() => {
    const actions = useStorageActions({
      parentRef: "private",
      maxUploadBytes: 1000,
      onChanged: noop,
    });
    const batch = useStorageBatch({
      folderRef: "private",
      onChanged: noop,
      onSelectionGone: noop,
    });
    const selection = useStorageSelection([], "private");
    return buildStorageCommands({
      actions,
      batch,
      selection,
      canWrite: false,
      folderRef: "private",
      items: [],
      operations: ["create_folder"],
    });
  });
  expect(
    hook.result.current.find((command) => command.id === "newFolder")
      ?.isDisabled,
  ).toBe(true);
});
