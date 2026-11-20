import { expect, it, vi } from "vitest";

import { GoogleDriveFilesClient, isDriveId } from "./GoogleDriveFilesClient";

const folderMime = "application/vnd.google-apps.folder";

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

it("validates Drive identifiers", () => {
  expect(isDriveId("A-b_09")).toBe(true);
  expect(isDriveId("a".repeat(200))).toBe(true);
  expect(isDriveId("a".repeat(201))).toBe(false);
  expect(isDriveId("")).toBe(false);
  expect(isDriveId("bad'id")).toBe(false);
});

it("reads folder metadata with encoded identifiers and authorization", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      reply({
        id: "id",
        name: "Folder",
        mimeType: folderMime,
        parents: ["parent"],
        trashed: true,
        driveId: "drive",
      }),
    )
    .mockResolvedValueOnce(reply({ id: "file", parents: [4] }));
  const client = new GoogleDriveFilesClient(fetcher);
  await expect(client.readFolder("secret", "id/part")).resolves.toEqual({
    ok: true,
    value: {
      id: "id",
      name: "Folder",
      isFolder: true,
      isTrashed: true,
      parentId: "parent",
      driveId: "drive",
    },
  });
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.pathname).toBe("/drive/v3/files/id%2Fpart");
  expect(url.searchParams.get("supportsAllDrives")).toBe("true");
  expect(fetcher.mock.calls[0][0]).not.toContain("secret");
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "GET",
    redirect: "error",
    headers: { Authorization: "Bearer secret", Accept: "application/json" },
  });
  await expect(client.readFolder("secret", "file")).resolves.toEqual({
    ok: true,
    value: {
      id: "file",
      name: "",
      isFolder: false,
      isTrashed: false,
      parentId: null,
      driveId: null,
    },
  });
});

it("lists files and shared drives with pagination and filters malformed entries", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      reply({
        nextPageToken: "next",
        files: [
          {
            id: "folder",
            name: "Folder",
            mimeType: folderMime,
            size: "42",
            modifiedTime: "today",
            webViewLink: "https://example.test/file",
          },
          { id: "file", size: "-1", webViewLink: "http://unsafe" },
          {},
          null,
        ],
      }),
    )
    .mockResolvedValueOnce(reply({ files: [] }))
    .mockResolvedValueOnce(
      reply({ drives: [{ id: "team", name: "Team" }, {}, null] }),
    )
    .mockResolvedValueOnce(reply({ drives: [], nextPageToken: "more" }));
  const client = new GoogleDriveFilesClient(fetcher);
  await expect(
    client.listFolder("token", {
      folderId: "parent",
      driveId: "drive",
      pageToken: "page",
      isFoldersOnly: true,
    }),
  ).resolves.toEqual({
    ok: true,
    value: {
      nextPageToken: "next",
      items: [
        {
          id: "folder",
          name: "Folder",
          mimeType: folderMime,
          isFolder: true,
          sizeBytes: 42,
          modifiedAt: "today",
          webViewLink: "https://example.test/file",
        },
        {
          id: "file",
          name: "",
          mimeType: "",
          isFolder: false,
          sizeBytes: null,
          modifiedAt: null,
          webViewLink: null,
        },
      ],
    },
  });
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get("q")).toBe(
    `'parent' in parents and trashed = false and mimeType = '${folderMime}'`,
  );
  expect(url.searchParams.get("corpora")).toBe("drive");
  expect(url.searchParams.get("driveId")).toBe("drive");
  expect(url.searchParams.get("pageToken")).toBe("page");
  await client.listFolder("token", {
    folderId: "root",
    driveId: null,
    pageToken: null,
    isFoldersOnly: false,
  });
  const rootUrl = new URL(fetcher.mock.calls[1][0]);
  expect(rootUrl.searchParams.get("q")).toBe(
    "'root' in parents and trashed = false",
  );
  expect(rootUrl.searchParams.has("driveId")).toBe(false);
  await expect(client.listSharedDrives("token", null)).resolves.toEqual({
    ok: true,
    value: {
      nextPageToken: null,
      items: [
        {
          id: "team",
          name: "Team",
          mimeType: folderMime,
          isFolder: true,
          modifiedAt: null,
          sizeBytes: null,
          webViewLink: null,
        },
      ],
    },
  });
  await client.listSharedDrives("token", "cursor");
  expect(new URL(fetcher.mock.calls[3][0]).searchParams.get("pageToken")).toBe(
    "cursor",
  );
});

it("reads shared drive names and quotas, rejecting malformed responses", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ name: "Team" }))
    .mockResolvedValueOnce(
      reply({
        storageQuota: { usage: "12", usageInDrive: "8", limit: "100" },
        user: { emailAddress: "a@example.test" },
      }),
    )
    .mockResolvedValueOnce(
      reply({ storageQuota: { usage: "0", limit: "bad" } }),
    )
    .mockResolvedValueOnce(reply({ storageQuota: { usage: "-1" } }))
    .mockResolvedValueOnce(reply({}))
    .mockResolvedValueOnce(reply([]))
    .mockResolvedValueOnce(reply({ files: null }))
    .mockResolvedValueOnce(reply({}));
  const client = new GoogleDriveFilesClient(fetcher);
  await expect(client.readSharedDriveName("token", "id/name")).resolves.toEqual(
    { ok: true, value: "Team" },
  );
  expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe(
    "/drive/v3/drives/id%2Fname",
  );
  await expect(client.readQuota("token")).resolves.toEqual({
    ok: true,
    value: {
      usageBytes: 12,
      usageInDriveBytes: 8,
      limitBytes: 100,
      emailAddress: "a@example.test",
    },
  });
  await expect(client.readQuota("token")).resolves.toEqual({
    ok: true,
    value: {
      usageBytes: 0,
      usageInDriveBytes: null,
      limitBytes: null,
      emailAddress: null,
    },
  });
  for (const request of [
    () => client.readQuota("token"),
    () => client.readQuota("token"),
    () => client.readSharedDriveName("token", "id"),
    () => client.listSharedDrives("token", null),
    () => client.readFolder("token", "id"),
  ]) {
    await expect(request()).resolves.toEqual({
      ok: false,
      folderProblem: "unreachable",
      connectionProblem: null,
    });
  }
});

it.each([
  [401, "", "unreachable", "access_revoked"],
  [403, "accessNotConfigured", "unreachable", "drive_api_disabled"],
  [404, "", "not_found", null],
  [403, "insufficientPermissions", "scope_insufficient", null],
  [403, "insufficientScopes", "scope_insufficient", null],
  [403, "other", "forbidden", null],
  [500, "", "unreachable", null],
])(
  "maps a Drive refusal %s %s",
  async (status, reason, folderProblem, connectionProblem) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(reply({ error: { errors: [{ reason }] } }, status));
    await expect(
      new GoogleDriveFilesClient(fetcher).readFolder("token", "id"),
    ).resolves.toEqual({ ok: false, folderProblem, connectionProblem });
  },
);

it("reports network failure and uses the default fetch when supplied", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(reply({ id: "root" }));
  vi.stubGlobal("fetch", fetcher);
  try {
    const client = new GoogleDriveFilesClient();
    await expect(client.readFolder("token", "root")).resolves.toMatchObject({
      ok: false,
      folderProblem: "unreachable",
    });
    await expect(client.readFolder("token", "root")).resolves.toMatchObject({
      ok: true,
      value: { id: "root" },
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
