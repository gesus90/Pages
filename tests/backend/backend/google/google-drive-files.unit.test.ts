import { expect, it, vi } from "vitest";

import {
  GoogleDriveFilesClient,
  isDriveId,
} from "@/backend/google/GoogleDriveFilesClient";

import type { GoogleFetch } from "@/backend/google/GoogleDriveResponses";

it("maps folder listings and confines tokens to authorization headers", async () => {
  const fetcher = vi.fn<GoogleFetch>(async () =>
    Response.json({
      files: [
        {
          id: "file",
          name: "Document",
          mimeType: "text/plain",
          size: "42",
          webViewLink: "https://example.org/file",
        },
        {
          id: "folder",
          name: "Folder",
          mimeType: "application/vnd.google-apps.folder",
          size: "invalid",
          webViewLink: "http://unsafe",
        },
        { name: "missing id" },
        null,
      ],
      nextPageToken: "next",
    }),
  );
  const client = new GoogleDriveFilesClient(fetcher);
  const result = await client.listFolder("secret", {
    folderId: "parent",
    driveId: "drive",
    pageToken: "cursor",
    isFoldersOnly: true,
  });
  expect(result).toMatchObject({
    ok: true,
    value: {
      nextPageToken: "next",
      items: [
        {
          id: "file",
          isFolder: false,
          sizeBytes: 42,
          webViewLink: "https://example.org/file",
        },
        { id: "folder", isFolder: true, sizeBytes: null, webViewLink: null },
      ],
    },
  });
  const [url, init] = fetcher.mock.calls[0] ?? [];
  expect(String(url)).not.toContain("secret");
  expect(String(url)).toContain("driveId=drive");
  expect(init).toMatchObject({ headers: { Authorization: "Bearer secret" } });
  expect(isDriveId("abc_123-XYZ")).toBe(true);
  expect(isDriveId("bad' id")).toBe(false);
});

it("maps metadata, shared drives and quota from synthetic responses", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        id: "folder",
        name: "Folder",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["parent"],
        trashed: true,
        driveId: "drive",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ drives: [{ id: "drive", name: "Team" }, {}] }),
    )
    .mockResolvedValueOnce(Response.json({ id: "drive", name: "Team" }))
    .mockResolvedValueOnce(
      Response.json({
        storageQuota: { usage: "10", usageInDrive: "7", limit: "100" },
        user: { emailAddress: "a@example.org" },
      }),
    );
  const client = new GoogleDriveFilesClient(fetcher);
  await expect(client.readFolder("token", "folder")).resolves.toMatchObject({
    ok: true,
    value: {
      isFolder: true,
      isTrashed: true,
      parentId: "parent",
      driveId: "drive",
    },
  });
  await expect(client.listSharedDrives("token", null)).resolves.toMatchObject({
    ok: true,
    value: { items: [{ id: "drive", isFolder: true }], nextPageToken: null },
  });
  await expect(client.readSharedDriveName("token", "drive")).resolves.toEqual({
    ok: true,
    value: "Team",
  });
  await expect(client.readQuota("token")).resolves.toEqual({
    ok: true,
    value: {
      usageBytes: 10,
      usageInDriveBytes: 7,
      limitBytes: 100,
      emailAddress: "a@example.org",
    },
  });
});

it.each([
  [401, "", "unreachable", "access_revoked"],
  [403, "accessNotConfigured", "unreachable", "drive_api_disabled"],
  [404, "", "not_found", null],
  [403, "insufficientPermissions", "scope_insufficient", null],
  [403, "other", "forbidden", null],
  [500, "other", "unreachable", null],
])(
  "translates Drive refusal %s %s",
  async (status, reason, folderProblem, connectionProblem) => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: { errors: [{ reason }] } }, { status }),
    );
    await expect(
      new GoogleDriveFilesClient(fetcher).readFolder("token", "folder"),
    ).resolves.toEqual({ ok: false, folderProblem, connectionProblem });
  },
);

it("handles malformed and unavailable responses without leaking errors", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ storageQuota: {} }))
    .mockRejectedValueOnce(new Error("offline"));
  const client = new GoogleDriveFilesClient(fetcher);
  await expect(client.readQuota("token")).resolves.toMatchObject({
    ok: false,
    folderProblem: "unreachable",
  });
  await expect(client.readFolder("token", "folder")).resolves.toMatchObject({
    ok: false,
    folderProblem: "unreachable",
  });
});
