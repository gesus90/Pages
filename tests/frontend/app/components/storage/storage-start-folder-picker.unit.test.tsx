import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { StorageStartFolderPicker } from "@/app/components/storage/storage-start-folder-picker";
import { createI18n } from "@/app/lib/i18n";

import type {
  StorageBrowseResult,
  StorageFolderView,
  StoragePathEntry,
  StorageStartFolder,
} from "@/definition/GoogleDriveStorage";

const requests = vi.hoisted(() => ({
  folder: vi.fn(),
  change: vi.fn(),
  revalidate: vi.fn(async () => {}),
}));
vi.mock("@/app/components/storage/storage-requests", () => ({
  requestStorageFolder: requests.folder,
  requestStartFolderChange: requests.change,
}));
vi.mock("react-router", () => ({
  useRevalidator: () => ({ revalidate: requests.revalidate }),
}));

const i18n = createI18n("en");

const MY_DRIVE: StoragePathEntry = {
  id: "root",
  name: "",
  role: "my_drive",
};
const PROJECTS: StoragePathEntry = {
  id: "projects",
  name: "Projects",
  role: "folder",
};

function folderView(
  overrides: Partial<StorageFolderView> = {},
): StorageFolderView {
  return {
    folderId: "root",
    name: "My Drive",
    path: [MY_DRIVE],
    items: [],
    nextPageToken: null,
    canBeStartFolder: true,
    ...overrides,
  };
}

function browse(
  folder: StorageFolderView | null,
  hasSharedDrives = false,
): { ok: true; value: StorageBrowseResult } {
  return {
    ok: true,
    value: {
      kind: "browse",
      accountEmail: null,
      reach: "full",
      hasSharedDrives,
      startFolder: null,
      startFolderProblem: null,
      startFolderRenamedFrom: null,
      folderProblem: folder ? null : "not_found",
      folder,
    },
  };
}

function folderItem(
  id: string,
  name: string,
): StorageFolderView["items"][number] {
  return {
    id,
    name,
    isFolder: true,
    mimeType: "application/vnd.google-apps.folder",
    modifiedAt: null,
    sizeBytes: null,
    webViewLink: null,
  };
}

const SAVED: StorageStartFolder = {
  folderId: "projects",
  name: "Projects",
  path: [MY_DRIVE, PROJECTS],
};

function renderPicker(
  props: {
    startFolder?: StorageStartFolder | null;
    onSaved?: (startFolder: StorageStartFolder | null) => void;
    onOpenChange?: (isOpen: boolean) => void;
    isOpen?: boolean;
  } = {},
): void {
  render(
    <I18nextProvider i18n={i18n}>
      <StorageStartFolderPicker
        isOpen={props.isOpen ?? true}
        initialFolderId="root"
        startFolder={props.startFolder ?? null}
        onOpenChange={props.onOpenChange ?? vi.fn()}
        onSaved={props.onSaved ?? vi.fn()}
      />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  requests.folder.mockReset();
  requests.change.mockReset();
  requests.revalidate.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("renders nothing of the body while closed", () => {
  renderPicker({ isOpen: false });

  expect(screen.queryByText("Set start folder")).toBeNull();
  expect(requests.folder).not.toHaveBeenCalled();
});

it("asks for folders only and shows the loading note until the answer arrives", async () => {
  requests.folder.mockReturnValue(new Promise(() => {}));
  renderPicker();

  expect(
    screen.getByText("Loading the folder from Google Drive …"),
  ).toBeTruthy();
  expect(screen.getByText("No start folder set yet.")).toBeTruthy();
  expect(requests.folder).toHaveBeenCalledWith(
    { folderId: "root", isFoldersOnly: true, pageToken: null },
    expect.any(AbortSignal),
  );
  const confirm = screen.getByRole("button", { name: "Save this folder" });
  expect(confirm.hasAttribute("disabled")).toBe(true);
});

it("says so when the folder cannot be shown and keeps saving disabled", async () => {
  requests.folder.mockResolvedValue(browse(null));
  renderPicker();

  expect(await screen.findByText("This folder cannot be shown.")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Save this folder" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("treats a failed request as an unavailable folder and revalidates the session", async () => {
  requests.folder.mockResolvedValue({ ok: false, failure: "forbidden" });
  renderPicker();

  expect(await screen.findByText("This folder cannot be shown.")).toBeTruthy();
  await waitFor(() => expect(requests.revalidate).toHaveBeenCalledOnce());
});

it("names an empty folder and offers the shared drives root only when they exist", async () => {
  requests.folder.mockResolvedValue(browse(folderView(), true));
  renderPicker();

  expect(await screen.findByText("No subfolders.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "My Drive" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Shared drives" })).toBeTruthy();
});

it("hides the shared drives root without shared drives", async () => {
  requests.folder.mockResolvedValue(browse(folderView()));
  renderPicker();

  await screen.findByText("No subfolders.");
  expect(screen.queryByRole("button", { name: "Shared drives" })).toBeNull();
});

it("opens a subfolder, shows its path and goes back through the path", async () => {
  requests.folder.mockImplementation(async (query: { folderId: string }) =>
    query.folderId === "projects"
      ? browse(
          folderView({
            folderId: "projects",
            name: "Projects",
            path: [MY_DRIVE, PROJECTS],
            items: [folderItem("2026", "")],
          }),
        )
      : browse(folderView({ items: [folderItem("projects", "Projects")] })),
  );
  renderPicker();

  fireEvent.click(await screen.findByRole("button", { name: "Projects" }));

  expect(await screen.findByText("(untitled)")).toBeTruthy();
  expect(requests.folder).toHaveBeenLastCalledWith(
    { folderId: "projects", isFoldersOnly: true, pageToken: null },
    expect.any(AbortSignal),
  );
  expect(screen.getByText("Projects")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Projects" })).toBeNull();
  // The shown folder is the last step and no button; the root is one.
  const rootStep = screen.getAllByRole("button", { name: "My Drive" });
  fireEvent.click(rootStep[rootStep.length - 1]);

  expect(await screen.findByRole("button", { name: "Projects" })).toBeTruthy();
});

it("shows a detached step of the path without a button", async () => {
  requests.folder.mockResolvedValue(
    browse(
      folderView({
        folderId: "inner",
        path: [
          { id: "gone", name: "", role: "detached" },
          { id: "inner", name: "Inner", role: "folder" },
        ],
      }),
    ),
  );
  renderPicker();

  expect(await screen.findByText("…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "…" })).toBeNull();
  expect(screen.getByText("Inner")).toBeTruthy();
});

it("opens the shared drives root from its shortcut", async () => {
  requests.folder.mockResolvedValue(browse(folderView(), true));
  renderPicker();

  fireEvent.click(await screen.findByRole("button", { name: "Shared drives" }));

  await waitFor(() =>
    expect(requests.folder).toHaveBeenLastCalledWith(
      { folderId: "shared-drives", isFoldersOnly: true, pageToken: null },
      expect.any(AbortSignal),
    ),
  );
});

it("opens My Drive from its shortcut", async () => {
  requests.folder.mockResolvedValue(
    browse(folderView({ folderId: "other" }), true),
  );
  renderPicker();

  fireEvent.click(await screen.findByRole("button", { name: "Shared drives" }));
  fireEvent.click(screen.getByRole("button", { name: "My Drive" }));

  await waitFor(() =>
    expect(requests.folder).toHaveBeenLastCalledWith(
      { folderId: "root", isFoldersOnly: true, pageToken: null },
      expect.any(AbortSignal),
    ),
  );
});

it("disables saving where the folder cannot be a start folder", async () => {
  requests.folder.mockResolvedValue(
    browse(folderView({ folderId: "shared-drives", canBeStartFolder: false })),
  );
  renderPicker();

  await screen.findByText("No subfolders.");
  expect(
    screen
      .getByRole("button", { name: "Save this folder" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("saves the shown folder and reports the saved start folder", async () => {
  const onSaved = vi.fn();
  requests.folder.mockResolvedValue(browse(folderView()));
  requests.change.mockResolvedValue({
    ok: true,
    value: { ok: true, startFolder: SAVED },
  });
  renderPicker({ onSaved });

  fireEvent.click(
    await screen.findByRole("button", { name: "Save this folder" }),
  );

  await waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith(SAVED));
  expect(requests.change).toHaveBeenCalledExactlyOnceWith("root");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows the current start folder and clears it", async () => {
  const onSaved = vi.fn();
  requests.folder.mockResolvedValue(browse(folderView()));
  requests.change.mockResolvedValue({
    ok: true,
    value: { ok: true, startFolder: null },
  });
  renderPicker({ startFolder: SAVED, onSaved });

  expect(screen.getByText("Current: My Drive / Projects")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove start folder" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith(null));
  expect(requests.change).toHaveBeenCalledExactlyOnceWith(null);
});

it("marks saving as pending and blocks the clear button meanwhile", async () => {
  let finish: (reply: unknown) => void = () => {};
  requests.folder.mockResolvedValue(browse(folderView()));
  requests.change.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  renderPicker({ startFolder: SAVED });

  fireEvent.click(
    await screen.findByRole("button", { name: "Save this folder" }),
  );

  expect(
    screen
      .getByRole("button", { name: "Save this folder" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Remove start folder" })
      .hasAttribute("disabled"),
  ).toBe(true);
  finish({ ok: true, value: { ok: true, startFolder: SAVED } });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Remove start folder" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
});

it("names the refusal of the server and does not report a save", async () => {
  const onSaved = vi.fn();
  requests.folder.mockResolvedValue(browse(folderView()));
  requests.change.mockResolvedValue({
    ok: true,
    value: { ok: false, error: "trashed" },
  });
  renderPicker({ onSaved });

  fireEvent.click(
    await screen.findByRole("button", { name: "Save this folder" }),
  );

  expect((await screen.findByRole("alert")).textContent).toBe(
    "The folder is in the trash.",
  );
  expect(onSaved).not.toHaveBeenCalled();
});

it("shows the generic failure when the request itself fails and clears it on retry", async () => {
  requests.folder.mockResolvedValue(browse(folderView()));
  requests.change
    .mockResolvedValueOnce({ ok: false, failure: "failed" })
    .mockResolvedValueOnce({
      ok: true,
      value: { ok: true, startFolder: SAVED },
    });
  renderPicker();

  fireEvent.click(
    await screen.findByRole("button", { name: "Save this folder" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The start folder could not be saved.",
  );

  fireEvent.click(screen.getByRole("button", { name: "Save this folder" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
