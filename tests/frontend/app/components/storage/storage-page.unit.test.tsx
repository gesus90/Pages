import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { StoragePage } from "@/app/components/storage/storage-page";
import { createI18n } from "@/app/lib/i18n";

import type { StorageFolderActions } from "@/app/components/storage/use-storage-folder-actions";
import type { StorageFolderModel } from "@/app/components/storage/use-storage-folder";
import type { StorageCapabilities } from "@/definition/GoogleDriveFiles";
import type {
  StorageBrowseResult,
  StorageStartFolder,
} from "@/definition/GoogleDriveStorage";

const mocks = vi.hoisted(() => ({
  folder: vi.fn(),
  folderActions: vi.fn(),
  manager: vi.fn(),
  startFolderChange: vi.fn(),
  picker: vi.fn(),
  content: vi.fn(),
}));

vi.mock("@/app/components/storage/use-storage-folder", () => ({
  useStorageFolder: mocks.folder,
}));
vi.mock("@/app/components/storage/use-storage-folder-actions", () => ({
  useStorageFolderActions: mocks.folderActions,
}));
vi.mock("@/app/components/storage/use-storage-file-manager", () => ({
  useStorageFileManager: mocks.manager,
}));
vi.mock("@/app/components/storage/storage-requests", () => ({
  requestStartFolderChange: mocks.startFolderChange,
}));
vi.mock("@/app/components/storage/storage-header", () => ({
  StorageHeader: (props: {
    isConnected: boolean;
    path: readonly { name: string }[];
  }) => (
    <header data-testid="header">
      {String(props.isConnected)}:
      {props.path.map((step) => step.name).join(">")}
    </header>
  ),
}));
vi.mock("@/app/components/storage/storage-action-toolbar", () => ({
  StorageActionToolbar: (props: {
    canAddHere: boolean;
    isTrashOpen: boolean;
    onToggleTrash: () => void;
  }) => (
    <div data-testid="action-toolbar">
      <span>
        add:{String(props.canAddHere)} trash:{String(props.isTrashOpen)}
      </span>
      <button onClick={props.onToggleTrash} type="button">
        toggle trash
      </button>
    </div>
  ),
}));
vi.mock("@/app/components/storage/storage-action-dialogs", () => ({
  StorageActionDialogs: () => <div data-testid="dialogs" />,
}));
vi.mock("@/app/components/storage/storage-trash-panel", () => ({
  StorageTrashPanel: (props: { canWrite: boolean }) => (
    <div data-testid="trash">write:{String(props.canWrite)}</div>
  ),
}));
vi.mock("@/app/components/storage/storage-content", () => ({
  StorageContent: (props: {
    onChooseStartFolder: () => void;
    onClearStartFolder: () => void;
  }) => {
    mocks.content(props);

    return (
      <div data-testid="content">
        <button onClick={props.onChooseStartFolder} type="button">
          content choose
        </button>
        <button onClick={props.onClearStartFolder} type="button">
          content clear
        </button>
      </div>
    );
  },
}));
vi.mock("@/app/components/storage/storage-start-folder-picker", () => ({
  StorageStartFolderPicker: (props: {
    initialFolderId: string;
    isOpen: boolean;
    startFolder: StorageStartFolder | null;
    onOpenChange: (isOpen: boolean) => void;
    onSaved: (startFolder: StorageStartFolder | null) => void;
  }) => {
    mocks.picker(props);

    return (
      <div data-testid="picker">
        open:{String(props.isOpen)} initial:{props.initialFolderId}
        <button
          onClick={() =>
            props.onSaved({ folderId: "saved", name: "Saved", path: [] })
          }
          type="button"
        >
          picker save
        </button>
        <button onClick={() => props.onOpenChange(false)} type="button">
          picker close
        </button>
      </div>
    );
  },
}));

const i18n = createI18n("en");

const START: StorageStartFolder = {
  folderId: "start-1",
  name: "Work",
  path: [{ id: "root", name: "", role: "my_drive" }],
};

function resultOf(
  overrides: Partial<StorageBrowseResult> = {},
): StorageBrowseResult {
  const base: StorageBrowseResult = {
    accountEmail: "me@example.test",
    folder: {
      canBeStartFolder: true,
      folderId: "folder-1",
      items: [],
      name: "Projects",
      nextPageToken: null,
      path: [{ id: "folder-1", name: "Projects", role: "folder" }],
    },
    folderProblem: null,
    hasSharedDrives: false,
    kind: "browse",
    reach: "full",
    startFolder: null,
    startFolderProblem: null,
    startFolderRenamedFrom: null,
  };

  return { ...base, ...overrides };
}

function modelOf(
  overrides: Partial<StorageFolderModel> = {},
): StorageFolderModel {
  return {
    isLoadingMore: false,
    loadMore: vi.fn(),
    loadMoreFailed: false,
    previousResult: null,
    reading: { kind: "loaded", result: resultOf() },
    reload: vi.fn(),
    replaceStartFolder: vi.fn(),
    ...overrides,
  };
}

function capabilitiesOf(
  overrides: Partial<StorageCapabilities> = {},
): StorageCapabilities {
  return {
    canRead: true,
    canRequestWriteAccess: true,
    canWrite: true,
    exportFormats: {},
    isSimulation: false,
    maxReadBytes: 1,
    maxUploadBytes: 1,
    operations: [],
    pageSizeLimit: 10,
    ...overrides,
  };
}

function writingOf(
  overrides: Partial<StorageFolderActions> = {},
): StorageFolderActions {
  return {
    actions: {
      closeDialog: vi.fn(),
      confirm: vi.fn(),
      deletePermanently: vi.fn(),
      dialog: { kind: "none" },
      dismissError: vi.fn(),
      error: null,
      isBusy: false,
      keepBoth: vi.fn(),
      openNameDialog: vi.fn(),
      replace: vi.fn(),
      restore: vi.fn(),
      submitName: vi.fn(),
      upload: vi.fn(),
    },
    canAddHere: true,
    canWrite: true,
    capabilities: capabilitiesOf(),
    renderActions: undefined,
    ...overrides,
  };
}

function renderPage(url = "/storage"): void {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[url]}>
        <StoragePage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function setup(
  model: StorageFolderModel = modelOf(),
  writing: StorageFolderActions = writingOf(),
): { model: StorageFolderModel; writing: StorageFolderActions } {
  mocks.folder.mockReturnValue(model);
  mocks.folderActions.mockReturnValue(writing);

  return { model, writing };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.manager.mockReturnValue({
    notices: <div data-testid="notices" />,
    overlays: <div data-testid="overlays" />,
    tools: undefined,
  });
  mocks.startFolderChange.mockResolvedValue({ ok: true, startFolder: null });
  setup();
});

it("asks for the folder of the address and passes it on trimmed", () => {
  renderPage("/storage?folder=%20abc%20");

  expect(mocks.folder).toHaveBeenCalledWith({
    folderId: "abc",
    isFoldersOnly: false,
  });
});

it("opens the start folder when the address names no or a blank folder", () => {
  renderPage("/storage?folder=%20%20");

  expect(mocks.folder).toHaveBeenCalledWith({
    folderId: null,
    isFoldersOnly: false,
  });
});

it("shows header, toolbar, content and picker for a loaded folder", () => {
  renderPage();

  expect(screen.getByTestId("header").textContent).toBe("true:Projects");
  expect(
    screen.getByRole("link", { name: "My Drive" }).getAttribute("href"),
  ).toBe("/storage?folder=root");
  expect(screen.queryByRole("link", { name: "Shared drives" })).toBeNull();
  expect(screen.getByTestId("action-toolbar").textContent).toContain(
    "add:true",
  );
  expect(screen.getByTestId("content")).toBeTruthy();
  expect(screen.getByTestId("dialogs")).toBeTruthy();
  expect(screen.getByTestId("notices")).toBeTruthy();
  expect(screen.getByTestId("overlays")).toBeTruthy();
  expect(screen.getByTestId("picker").textContent).toContain("open:false");
});

it("hands the file manager the loaded result, the actions and the reload", () => {
  const { model, writing } = setup();

  renderPage();

  expect(mocks.folderActions).toHaveBeenCalledWith(
    (model.reading as { result: StorageBrowseResult }).result,
    model.reload,
  );
  expect(mocks.manager).toHaveBeenCalledWith(
    (model.reading as { result: StorageBrowseResult }).result,
    writing,
    model.reload,
  );
});

it("shows only header and content while the first folder loads", () => {
  setup(modelOf({ reading: { kind: "loading" } }));

  renderPage();

  expect(screen.getByTestId("header").textContent).toBe("false:");
  expect(screen.queryByRole("link", { name: "My Drive" })).toBeNull();
  expect(screen.queryByTestId("action-toolbar")).toBeNull();
  expect(screen.queryByTestId("picker")).toBeNull();
  expect(screen.getByTestId("content")).toBeTruthy();
});

it("keeps the former folder in place while another one loads", () => {
  const previous = resultOf();
  setup(modelOf({ previousResult: previous, reading: { kind: "loading" } }));

  renderPage();

  expect(screen.getByTestId("header").textContent).toBe("true:Projects");
  expect(screen.getByTestId("action-toolbar").textContent).toContain(
    "add:false",
  );
  expect(mocks.folderActions).toHaveBeenCalledWith(previous, expect.anything());
});

it("shows no folder path for a result without folder and offers the shared drives", () => {
  setup(
    modelOf({
      reading: {
        kind: "loaded",
        result: resultOf({ folder: null, hasSharedDrives: true }),
      },
    }),
  );

  renderPage();

  expect(screen.getByTestId("header").textContent).toBe("true:");
  expect(
    screen.getByRole("link", { name: "Shared drives" }).getAttribute("href"),
  ).toBe("/storage?folder=shared-drives");
  expect(mocks.picker.mock.calls.at(-1)?.[0].initialFolderId).toBe("root");
});

it("opens the picker at the shown folder when it can be a start folder", () => {
  renderPage();

  expect(mocks.picker.mock.calls.at(-1)?.[0].initialFolderId).toBe("folder-1");
});

it("opens the picker at My Drive when the shown folder cannot be a start folder", () => {
  const result = resultOf();
  const folder = result.folder;

  if (folder === null) throw new Error("fixture has a folder");

  setup(
    modelOf({
      reading: {
        kind: "loaded",
        result: { ...result, folder: { ...folder, canBeStartFolder: false } },
      },
    }),
  );

  renderPage();

  expect(mocks.picker.mock.calls.at(-1)?.[0].initialFolderId).toBe("root");
});

it("names the start folder or says there is none", () => {
  setup(
    modelOf({
      reading: { kind: "loaded", result: resultOf({ startFolder: START }) },
    }),
  );
  renderPage();

  expect(screen.getByText("Start folder: My Drive")).toBeTruthy();
});

it("says that no start folder is set", () => {
  renderPage();

  expect(screen.getByText(/No start folder set/)).toBeTruthy();
});

it("offers the way back to the start folder only for an explicit target", () => {
  setup(
    modelOf({
      reading: { kind: "loaded", result: resultOf({ startFolder: START }) },
    }),
  );
  const { unmount } = render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/storage?folder=other"]}>
        <StoragePage />
      </MemoryRouter>
    </I18nextProvider>,
  );

  expect(
    screen
      .getByRole("link", { name: "Go to start folder" })
      .getAttribute("href"),
  ).toBe("/storage");
  unmount();

  renderPage();
  expect(screen.queryByRole("link", { name: "Go to start folder" })).toBeNull();
});

it("offers no way back without a start folder even for an explicit target", () => {
  renderPage("/storage?folder=other");

  expect(screen.queryByRole("link", { name: "Go to start folder" })).toBeNull();
});

it("opens the picker from the toolbar and closes it again", () => {
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Set start folder" }));
  expect(screen.getByTestId("picker").textContent).toContain("open:true");

  fireEvent.click(screen.getByRole("button", { name: "picker close" }));
  expect(screen.getByTestId("picker").textContent).toContain("open:false");
});

it("opens the picker from the empty content too", () => {
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "content choose" }));

  expect(screen.getByTestId("picker").textContent).toContain("open:true");
});

it("shows a saved start folder in place without asking Drive again", () => {
  const { model } = setup();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Set start folder" }));
  fireEvent.click(screen.getByRole("button", { name: "picker save" }));

  expect(model.replaceStartFolder).toHaveBeenCalledWith({
    folderId: "saved",
    name: "Saved",
    path: [],
  });
  expect(model.reload).not.toHaveBeenCalled();
  expect(screen.getByTestId("picker").textContent).toContain("open:false");
});

it("reloads after saving when no folder is shown", () => {
  const { model } = setup(
    modelOf({
      reading: {
        kind: "loaded",
        result: resultOf({ folder: null }),
      },
    }),
  );
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "picker save" }));

  expect(model.reload).toHaveBeenCalledTimes(1);
  expect(model.replaceStartFolder).not.toHaveBeenCalled();
});

it("clears the start folder and then reloads", async () => {
  const { model } = setup();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "content clear" }));

  expect(mocks.startFolderChange).toHaveBeenCalledWith(null);
  expect(model.reload).not.toHaveBeenCalled();
  await waitFor(() => expect(model.reload).toHaveBeenCalledTimes(1));
});

it("switches to the trash and reloads the folder when it closes", () => {
  const { model } = setup();
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "toggle trash" }));

  expect(screen.getByTestId("trash").textContent).toBe("write:true");
  expect(screen.queryByTestId("content")).toBeNull();
  expect(screen.queryByTestId("notices")).toBeNull();
  expect(screen.getByTestId("action-toolbar").textContent).toContain(
    "trash:true",
  );
  expect(model.reload).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "toggle trash" }));

  expect(model.reload).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("trash")).toBeNull();
  expect(screen.getByTestId("content")).toBeTruthy();
  expect(screen.getByTestId("notices")).toBeTruthy();
});

it("passes the write right to the trash panel", () => {
  setup(modelOf(), writingOf({ canWrite: false }));
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "toggle trash" }));

  expect(screen.getByTestId("trash").textContent).toBe("write:false");
});

it("shows no message block for a plain full-access folder", () => {
  renderPage();

  expect(screen.queryByText("Simulated Google Drive")).toBeNull();
  expect(screen.queryByText("Write access missing")).toBeNull();
  expect(screen.queryByText(/Only files created or opened/)).toBeNull();
});

it("announces the simulation from the folder answer", () => {
  setup(
    modelOf({
      reading: {
        kind: "loaded",
        result: resultOf({ isSimulation: true }),
      },
    }),
    writingOf({ capabilities: null }),
  );

  renderPage();

  expect(screen.getByText("Simulated Google Drive")).toBeTruthy();
});

it("announces the simulation from the capabilities", () => {
  setup(
    modelOf(),
    writingOf({ capabilities: capabilitiesOf({ isSimulation: true }) }),
  );

  renderPage();

  expect(screen.getByText("Simulated Google Drive")).toBeTruthy();
});

it("explains a read-only connection and a read-only simulation scenario", () => {
  setup(
    modelOf(),
    writingOf({ capabilities: capabilitiesOf({ canWrite: false }) }),
  );
  const { unmount } = render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <StoragePage />
      </MemoryRouter>
    </I18nextProvider>,
  );
  expect(screen.getByText("Write access missing")).toBeTruthy();
  unmount();

  setup(
    modelOf(),
    writingOf({
      capabilities: capabilitiesOf({ canWrite: false, isSimulation: true }),
    }),
  );
  renderPage();
  expect(
    screen.getByText(/This simulation scenario is read-only/),
  ).toBeTruthy();
});

it("explains that the connection only reaches the files of Pages", () => {
  setup(
    modelOf({
      reading: {
        kind: "loaded",
        result: resultOf({ reach: "app_files" }),
      },
    }),
  );

  renderPage();

  expect(
    screen.getByText("Only files created or opened by Pages are visible"),
  ).toBeTruthy();
});

it("names a renamed start folder", () => {
  setup(
    modelOf({
      reading: {
        kind: "loaded",
        result: resultOf({ startFolder: START, startFolderRenamedFrom: "Old" }),
      },
    }),
  );

  renderPage();

  expect(
    screen.getByText(/The start folder "Old" is now called "Work"/),
  ).toBeTruthy();
});

it("shows no renamed notice when the start folder is gone", () => {
  setup(
    modelOf({
      reading: {
        kind: "loaded",
        result: resultOf({ startFolder: null, startFolderRenamedFrom: "Old" }),
      },
    }),
  );

  renderPage();

  expect(screen.queryByText(/is now called/)).toBeNull();
});

it("shows a failure that no dialog resolves and lets the person dismiss it", () => {
  const writing = writingOf();
  setup(modelOf(), {
    ...writing,
    actions: { ...writing.actions, error: { code: "failed" } },
  });

  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

  expect(writing.actions.dismissError).toHaveBeenCalledTimes(1);
});

it("hides the action error while a dialog is open", () => {
  const writing = writingOf();
  setup(modelOf(), {
    ...writing,
    actions: {
      ...writing.actions,
      dialog: { kind: "name", purpose: "create_folder", target: null },
      error: { code: "failed" },
    },
  });

  renderPage();

  expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
});
