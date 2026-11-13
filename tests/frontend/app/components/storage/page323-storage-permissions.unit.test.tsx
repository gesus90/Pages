import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { requestStorageFolder } from "@/app/components/storage/storage-requests";
import { StorageAccessCard } from "@/app/components/settings/system/storage-access-card";
import { StorageHistory } from "@/app/components/storage/storage-history";
import { useStorageCapabilities } from "@/app/components/storage/use-storage-capabilities";
import { createI18n } from "@/app/lib/i18n";

import type { StorageCapabilities } from "@/definition/GoogleDriveFiles";

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
});

const SETTINGS = {
  ok: true,
  result: {
    grants: [],
    targets: [{ kind: "group", id: "a-team", name: "A-Team" }],
  },
};
const CAPABILITIES: StorageCapabilities = {
  canRead: true,
  canWrite: true,
  canRequestWriteAccess: false,
  operations: ["list", "upload", "create_folder", "update"],
  maxUploadBytes: 1000,
  maxReadBytes: 1000,
  pageSizeLimit: 100,
  exportFormats: {},
  isSimulation: false,
  grantedFolders: [{ ref: "pages", name: "Pages" }],
};

it("submits a folder-scoped A-Team grant and lists it only after a successful response", async () => {
  fetcher.mockResolvedValueOnce(Response.json(SETTINGS));
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <StorageAccessCard />
    </I18nextProvider>,
  );
  await screen.findByRole("option", { name: "A-Team · Gruppe" });
  fireEvent.change(screen.getByLabelText(/Ordnerpfad/u), {
    target: { value: "/Storage/Pages" },
  });
  fireEvent.change(screen.getByLabelText("Rolle, Abteilung oder Gruppe"), {
    target: { value: "group:a-team" },
  });
  fetcher.mockResolvedValueOnce(Response.json({ ok: true, result: {} }));
  fetcher.mockResolvedValueOnce(
    Response.json({
      ...SETTINGS,
      result: {
        ...SETTINGS.result,
        grants: [
          {
            permissionId: "google",
            folderRef: "pages",
            folderName: "Pages",
            targetKind: "group",
            targetId: "a-team",
          },
        ],
      },
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Storage schreiben erlauben" }),
  );
  await screen.findByText("Pages · A-Team");
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
    path: "/Storage/Pages",
    targetKind: "group",
    targetId: "a-team",
    enabled: true,
  });
  fetcher.mockResolvedValueOnce(Response.json({ ok: true, result: {} }));
  fetcher.mockResolvedValueOnce(Response.json(SETTINGS));
  fireEvent.click(screen.getByRole("button", { name: "Entziehen" }));
  await waitFor(() => expect(screen.queryByText("Pages · A-Team")).toBeNull());
  expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body))).toEqual({
    folderRef: "pages",
    targetKind: "group",
    targetId: "a-team",
    enabled: false,
  });
});

it("shows a denied grant as an error and never pretends that the grant was saved", async () => {
  fetcher.mockResolvedValueOnce(Response.json(SETTINGS));
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <StorageAccessCard />
    </I18nextProvider>,
  );
  await screen.findByRole("option", { name: "A-Team · Gruppe" });
  fireEvent.change(screen.getByLabelText(/Ordnerpfad/u), {
    target: { value: "/Storage/Pages" },
  });
  fireEvent.change(screen.getByLabelText("Rolle, Abteilung oder Gruppe"), {
    target: { value: "group:a-team" },
  });
  fetcher.mockResolvedValueOnce(
    Response.json({ ok: false, error: { code: "forbidden" } }, { status: 403 }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Storage schreiben erlauben" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "nicht gelesen oder gespeichert",
  );
  expect(screen.queryByText("Pages · A-Team")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not enable grant editing when loading settings is forbidden", async () => {
  fetcher.mockResolvedValueOnce(
    Response.json({ ok: false, error: { code: "forbidden" } }, { status: 403 }),
  );
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <StorageAccessCard />
    </I18nextProvider>,
  );
  await screen.findByRole("alert");
  expect(
    screen
      .getByRole("button", { name: "Storage schreiben erlauben" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("reloads folder capabilities and clears a previously granted result when the next folder is forbidden", async () => {
  fetcher.mockResolvedValueOnce(
    Response.json({ ok: true, result: CAPABILITIES, simulation: false }),
  );
  const hook = renderHook(({ ref }) => useStorageCapabilities(ref), {
    initialProps: { ref: "pages" },
  });
  await waitFor(() => expect(hook.result.current?.canWrite).toBe(true));
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "/storage-api/v1/capabilities?ref=pages",
  );
  fetcher.mockResolvedValueOnce(
    Response.json(
      { ok: false, error: { code: "forbidden" }, simulation: false },
      { status: 403 },
    ),
  );
  await act(async () => hook.rerender({ ref: "private" }));
  await waitFor(() => expect(hook.result.current).toBeNull());
  expect(fetcher.mock.calls[1]?.[0]).toBe(
    "/storage-api/v1/capabilities?ref=private",
  );
});

it("shows the acting agent's name in Storage history", async () => {
  fetcher.mockResolvedValueOnce(
    Response.json({
      ok: true,
      result: [
        {
          actorId: "Ed",
          actorName: "Ed",
          operation: "upload",
          ref: "report",
          createdAt: "2026-11-13",
        },
      ],
    }),
  );
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <StorageHistory />
    </I18nextProvider>,
  );
  await screen.findByText("Ed");
  expect(screen.getByText(/Datei hochgeladen/u).textContent).toContain(
    "Datei hochgeladen",
  );
});

it("preserves the server's scoped view marker when parsing the shared folder listing", async () => {
  fetcher.mockResolvedValueOnce(
    Response.json({
      kind: "browse",
      isScoped: true,
      accountEmail: null,
      reach: "full",
      hasSharedDrives: false,
      startFolder: null,
      startFolderProblem: null,
      startFolderRenamedFrom: null,
      folderProblem: null,
      folder: {
        folderId: "root",
        name: "Storage",
        path: [],
        items: [],
        nextPageToken: null,
        canBeStartFolder: false,
      },
    }),
  );
  expect(
    await requestStorageFolder(
      { folderId: null, pageToken: null, isFoldersOnly: false },
      new AbortController().signal,
    ),
  ).toMatchObject({ ok: true, value: { isScoped: true } });
});
