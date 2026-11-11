import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { useStorageActions } from "@/app/components/storage/use-storage-actions";

import type { StorageActionsModel } from "@/app/components/storage/use-storage-actions";

import type {
  StorageApiReply,
  StorageChange,
} from "@/app/components/storage/storage-actions-requests";
import type {
  StorageConfirmation,
  StorageEntry,
  StorageError,
} from "@/definition/GoogleDriveFiles";

const requests = vi.hoisted(() => ({ change: vi.fn() }));
vi.mock("@/app/components/storage/storage-actions-requests", () => ({
  requestStorageChange: requests.change,
}));

const ENTRY: StorageEntry = {
  driveRef: null,
  exportFormats: [],
  isExplicitlyTrashed: false,
  isFolder: false,
  isGoogleDocument: false,
  isTrashed: false,
  mimeType: "text/plain",
  modifiedAt: null,
  name: "report.txt",
  parentRef: "folder-1",
  ref: "file-1",
  sizeBytes: 12,
  version: null,
  webViewLink: null,
};

const CONFIRMATION: StorageConfirmation = {
  action: "delete_permanently",
  expiresAt: "2026-01-01T00:00:00Z",
  scope: null,
  target: ENTRY,
  token: "token-1",
};

const TARGET = { isFolder: false, name: "report.txt", ref: "file-1" };

function succeeds(): StorageApiReply<unknown> {
  return { ok: true, simulation: false, value: {} };
}

function fails(error: StorageError): StorageApiReply<unknown> {
  return { error, ok: false };
}

interface Props {
  readonly parentRef: string | null;
}

function setup(
  maxUploadBytes: number | null = null,
  parentRef: string | null = "folder-1",
): {
  readonly hook: ReturnType<typeof renderHook<StorageActionsModel, Props>>;
  readonly onChanged: Mock;
} {
  const onChanged = vi.fn();
  const hook = renderHook(
    (props: Props) =>
      useStorageActions({
        maxUploadBytes,
        onChanged,
        parentRef: props.parentRef,
      }),
    { initialProps: { parentRef } },
  );

  return { hook, onChanged };
}

function lastChange(): StorageChange {
  const calls = requests.change.mock.calls;

  return calls[calls.length - 1]?.[0] as StorageChange;
}

beforeEach(() => {
  requests.change.mockReset();
  requests.change.mockResolvedValue(succeeds());
});

it("starts without dialog, error or pending work", () => {
  const { hook } = setup();

  expect(hook.result.current.dialog).toEqual({ kind: "none" });
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.isBusy).toBe(false);
});

it("creates a folder in the shown folder and reloads after success", async () => {
  const { hook, onChanged } = setup();

  act(() => hook.result.current.openNameDialog("create_folder", null));
  expect(hook.result.current.dialog).toEqual({
    kind: "name",
    purpose: "create_folder",
    target: null,
  });

  act(() => hook.result.current.submitName("Plans"));

  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(lastChange()).toEqual({
    fields: { name: "Plans", onConflict: "fail", parentRef: "folder-1" },
    operation: "create_folder",
  });
  expect(hook.result.current.dialog).toEqual({ kind: "none" });
  expect(hook.result.current.isBusy).toBe(false);
});

it("reports busy while a change is running", async () => {
  let resolve: (reply: StorageApiReply<unknown>) => void = () => {};
  requests.change.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { hook, onChanged } = setup();

  act(() => hook.result.current.restore(TARGET));
  expect(hook.result.current.isBusy).toBe(true);

  await act(async () => resolve(succeeds()));

  expect(hook.result.current.isBusy).toBe(false);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("submits no folder name without a shown folder", () => {
  const { hook } = setup(null, null);

  hook.rerender({ parentRef: null });
  act(() => hook.result.current.openNameDialog("create_folder", null));
  act(() => hook.result.current.submitName("Plans"));

  expect(requests.change).not.toHaveBeenCalled();
  expect(hook.result.current.dialog.kind).toBe("name");
});

it("renames the target of the name dialog", async () => {
  const { hook, onChanged } = setup();

  act(() => hook.result.current.openNameDialog("rename", TARGET));
  act(() => hook.result.current.submitName("final.txt"));

  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(lastChange()).toEqual({
    fields: { name: "final.txt", onConflict: "fail", ref: "file-1" },
    operation: "rename",
  });
});

it("submits no rename without a target and no name without a dialog", () => {
  const { hook } = setup();

  act(() => hook.result.current.submitName("ignored"));
  act(() => hook.result.current.openNameDialog("rename", null));
  act(() => hook.result.current.submitName("ignored"));

  expect(requests.change).not.toHaveBeenCalled();
});

it("keeps the name dialog open and shows the error that no dialog resolves", async () => {
  requests.change.mockResolvedValue(fails({ code: "invalid_request" }));
  const { hook, onChanged } = setup();

  act(() => hook.result.current.openNameDialog("create_folder", null));
  act(() => hook.result.current.submitName("bad/name"));

  await waitFor(() =>
    expect(hook.result.current.error).toEqual({ code: "invalid_request" }),
  );
  expect(hook.result.current.dialog.kind).toBe("name");
  expect(onChanged).not.toHaveBeenCalled();
});

it("clears the error when a name dialog opens or the error is dismissed", async () => {
  requests.change.mockResolvedValue(fails({ code: "failed" }));
  const { hook } = setup();

  act(() => hook.result.current.restore(TARGET));
  await waitFor(() => expect(hook.result.current.error).not.toBeNull());

  act(() => hook.result.current.dismissError());
  expect(hook.result.current.error).toBeNull();

  act(() => hook.result.current.restore(TARGET));
  await waitFor(() => expect(hook.result.current.error).not.toBeNull());

  act(() => hook.result.current.openNameDialog("rename", TARGET));
  expect(hook.result.current.error).toBeNull();
});

it("clears an earlier error when the next change starts", async () => {
  requests.change.mockResolvedValueOnce(fails({ code: "failed" }));
  const { hook } = setup();

  act(() => hook.result.current.restore(TARGET));
  await waitFor(() => expect(hook.result.current.error).not.toBeNull());

  act(() => hook.result.current.restore(TARGET));
  await waitFor(() => expect(hook.result.current.error).toBeNull());
});

it("uploads a file into the shown folder", async () => {
  const { hook, onChanged } = setup(100);
  const file = new File(["abc"], "a.txt");

  act(() => hook.result.current.upload(file));

  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(lastChange()).toEqual({
    fields: { onConflict: "fail", parentRef: "folder-1" },
    file,
    operation: "upload",
  });
});

it("refuses a file above the upload limit without calling the server", () => {
  const { hook } = setup(2);

  act(() => hook.result.current.upload(new File(["abc"], "a.txt")));

  expect(requests.change).not.toHaveBeenCalled();
  expect(hook.result.current.error).toEqual({
    code: "too_large",
    limitBytes: 2,
  });
});

it("does not upload without a shown folder", () => {
  const { hook } = setup();

  hook.rerender({ parentRef: null });
  act(() => hook.result.current.upload(new File(["abc"], "a.txt")));

  expect(requests.change).not.toHaveBeenCalled();
});

it("restores and deletes permanently by reference", async () => {
  const { hook, onChanged } = setup();

  act(() => hook.result.current.restore(TARGET));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(lastChange()).toEqual({
    fields: { ref: "file-1" },
    operation: "restore",
  });

  act(() => hook.result.current.deletePermanently(TARGET));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  expect(lastChange()).toEqual({
    fields: { ref: "file-1" },
    operation: "delete_permanently",
  });
});

it("opens a confirmation, then repeats the call with its token", async () => {
  requests.change.mockResolvedValueOnce(
    fails({ code: "confirmation_required", confirmation: CONFIRMATION }),
  );
  const { hook, onChanged } = setup();

  act(() => hook.result.current.deletePermanently(TARGET));

  await waitFor(() =>
    expect(hook.result.current.dialog).toMatchObject({
      isRefreshed: false,
      kind: "confirm",
    }),
  );
  expect(onChanged).not.toHaveBeenCalled();

  act(() => hook.result.current.confirm());

  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(lastChange()).toEqual({
    fields: { confirmation: "token-1", ref: "file-1" },
    operation: "delete_permanently",
  });
  expect(hook.result.current.dialog).toEqual({ kind: "none" });
});

it("marks a renewed confirmation after the object changed", async () => {
  requests.change.mockResolvedValueOnce(
    fails({ code: "confirmation_invalid", confirmation: CONFIRMATION }),
  );
  const { hook } = setup();

  act(() => hook.result.current.deletePermanently(TARGET));

  await waitFor(() =>
    expect(hook.result.current.dialog).toMatchObject({
      isRefreshed: true,
      kind: "confirm",
    }),
  );
});

it("shows a confirmation error without confirmation as a plain error", async () => {
  requests.change.mockResolvedValueOnce(
    fails({ code: "confirmation_required" }),
  );
  const { hook } = setup();

  act(() => hook.result.current.deletePermanently(TARGET));

  await waitFor(() =>
    expect(hook.result.current.error).toEqual({
      code: "confirmation_required",
    }),
  );
  expect(hook.result.current.dialog).toEqual({ kind: "none" });
});

it("confirm does nothing without a confirmation dialog", () => {
  const { hook } = setup();

  act(() => hook.result.current.confirm());
  act(() => hook.result.current.keepBoth());
  act(() => hook.result.current.replace());

  expect(requests.change).not.toHaveBeenCalled();
});

it("leads an upload name conflict to keep both or to overwrite", async () => {
  requests.change.mockResolvedValueOnce(
    fails({ code: "name_conflict", conflicts: [ENTRY] }),
  );
  const { hook, onChanged } = setup();
  const file = new File(["abc"], "report.txt");

  act(() => hook.result.current.upload(file));

  await waitFor(() =>
    expect(hook.result.current.dialog).toMatchObject({
      canReplace: true,
      conflicts: [ENTRY],
      kind: "conflict",
    }),
  );

  act(() => hook.result.current.keepBoth());
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(lastChange()).toEqual({
    fields: { onConflict: "keep_both", parentRef: "folder-1" },
    file,
    operation: "upload",
  });

  requests.change.mockResolvedValueOnce(
    fails({ code: "name_conflict", conflicts: [ENTRY] }),
  );
  act(() => hook.result.current.upload(file));
  await waitFor(() => expect(hook.result.current.dialog.kind).toBe("conflict"));

  act(() => hook.result.current.replace());
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  expect(lastChange().fields.onConflict).toBe("overwrite");
});

it("offers no overwrite for a folder name conflict and tolerates missing conflicts", async () => {
  requests.change.mockResolvedValueOnce(fails({ code: "name_conflict" }));
  const { hook } = setup();

  act(() => hook.result.current.openNameDialog("create_folder", null));
  act(() => hook.result.current.submitName("Plans"));

  await waitFor(() =>
    expect(hook.result.current.dialog).toEqual({
      canReplace: false,
      change: {
        fields: { name: "Plans", onConflict: "fail", parentRef: "folder-1" },
        operation: "create_folder",
      },
      conflicts: [],
      kind: "conflict",
    }),
  );
});

it("shows a name conflict of a repeated call as an error instead of a second dialog", async () => {
  requests.change.mockResolvedValue(fails({ code: "name_conflict" }));
  const { hook } = setup();

  act(() => hook.result.current.openNameDialog("create_folder", null));
  act(() => hook.result.current.submitName("Plans"));
  await waitFor(() => expect(hook.result.current.dialog.kind).toBe("conflict"));

  act(() => hook.result.current.keepBoth());

  await waitFor(() =>
    expect(hook.result.current.error).toEqual({ code: "name_conflict" }),
  );
});

it("closes the dialog and clears the error", async () => {
  requests.change.mockResolvedValue(fails({ code: "failed" }));
  const { hook } = setup();

  act(() => hook.result.current.openNameDialog("rename", TARGET));
  act(() => hook.result.current.submitName("x"));
  await waitFor(() => expect(hook.result.current.error).not.toBeNull());

  act(() => hook.result.current.closeDialog());

  expect(hook.result.current.dialog).toEqual({ kind: "none" });
  expect(hook.result.current.error).toBeNull();
});
