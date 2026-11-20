import { expect, it, vi } from "vitest";

import {
  escapeDriveLiteral,
  GoogleDriveItemsClient,
  toStorageEntry,
} from "./GoogleDriveItemsClient";

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

it("escapes Drive query literals and converts file metadata", () => {
  expect(escapeDriveLiteral("a\\b'c")).toBe("a\\\\b\\'c");
  expect(toStorageEntry(null)).toBeNull();
  expect(toStorageEntry({})).toBeNull();
  expect(
    toStorageEntry({
      id: "id",
      name: "Doc",
      mimeType: "application/vnd.google-apps.document",
      parents: ["parent"],
      trashed: true,
      explicitlyTrashed: true,
      driveId: "drive",
      size: "12",
      version: "3",
      modifiedTime: "today",
      webViewLink: "https://example.test/doc",
    }),
  ).toMatchObject({
    ref: "id",
    name: "Doc",
    parentRef: "parent",
    driveRef: "drive",
    isGoogleDocument: true,
    isTrashed: true,
    isExplicitlyTrashed: true,
    sizeBytes: 12,
    version: "3",
    webViewLink: "https://example.test/doc",
  });
  expect(
    toStorageEntry({
      id: "id",
      parents: [7],
      size: "-1",
      webViewLink: "http://bad",
    }),
  ).toMatchObject({
    parentRef: null,
    sizeBytes: null,
    webViewLink: null,
    isFolder: false,
    isGoogleDocument: false,
  });
});

it("lists entries and shared drives with query parameters", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      reply({ files: [{ id: "f" }, {}, null], nextPageToken: "next" }),
    )
    .mockResolvedValueOnce(reply({ files: [] }))
    .mockResolvedValueOnce(
      reply({
        drives: [{ id: "drive", name: "Team" }, {}, null],
        nextPageToken: "more",
      }),
    )
    .mockResolvedValueOnce(reply({ drives: [] }));
  const client = new GoogleDriveItemsClient(fetcher);
  await expect(
    client.query("secret", {
      query: "name = 'a'",
      driveId: "drive",
      pageToken: "page",
      pageSize: 25,
    }),
  ).resolves.toMatchObject({
    ok: true,
    value: { entries: [{ ref: "f" }], nextPageToken: "next" },
  });
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get("q")).toBe("name = 'a'");
  expect(url.searchParams.get("corpora")).toBe("drive");
  expect(url.searchParams.get("pageToken")).toBe("page");
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  await client.query("secret", {
    query: "",
    driveId: null,
    pageToken: null,
    pageSize: 1,
  });
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.has("driveId")).toBe(
    false,
  );
  await expect(
    client.listSharedDrives("secret", { pageSize: 200, pageToken: "cursor" }),
  ).resolves.toMatchObject({
    ok: true,
    value: {
      entries: [{ ref: "drive", driveRef: "drive", isFolder: true }],
      nextPageToken: "more",
    },
  });
  const drivesUrl = new URL(fetcher.mock.calls[2][0]);
  expect(drivesUrl.searchParams.get("pageSize")).toBe("100");
  expect(drivesUrl.searchParams.get("pageToken")).toBe("cursor");
  await client.listSharedDrives("secret", { pageSize: 10, pageToken: null });
  expect(new URL(fetcher.mock.calls[3][0]).searchParams.has("pageToken")).toBe(
    false,
  );
});

it("reads quota and rejects invalid JSON shapes", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      reply({
        storageQuota: {
          usage: "12",
          limit: "100",
          usageInDrive: "8",
          usageInDriveTrash: "2",
        },
      }),
    )
    .mockResolvedValueOnce(reply({ storageQuota: { usage: "0" } }))
    .mockResolvedValueOnce(reply({ storageQuota: { usage: "bad" } }))
    .mockResolvedValueOnce(reply({}))
    .mockResolvedValueOnce(reply({ files: null }))
    .mockResolvedValueOnce(reply({ drives: null }))
    .mockResolvedValueOnce(reply({}));
  const client = new GoogleDriveItemsClient(fetcher);
  await expect(client.readQuota("token")).resolves.toEqual({
    ok: true,
    value: {
      usageBytes: 12,
      limitBytes: 100,
      usageInDriveBytes: 8,
      usageInTrashBytes: 2,
    },
  });
  await expect(client.readQuota("token")).resolves.toEqual({
    ok: true,
    value: {
      usageBytes: 0,
      limitBytes: null,
      usageInDriveBytes: null,
      usageInTrashBytes: null,
    },
  });
  for (const request of [
    () => client.readQuota("token"),
    () => client.readQuota("token"),
    () =>
      client.query("token", {
        query: "",
        driveId: null,
        pageToken: null,
        pageSize: 1,
      }),
    () => client.listSharedDrives("token", { pageToken: null, pageSize: 1 }),
    () => client.stat("token", "id"),
  ]) {
    await expect(request()).resolves.toEqual({
      ok: false,
      code: "provider_unreachable",
      connectionProblem: null,
    });
  }
});

it.each([null, [], "text", 42, false])(
  "rejects a quota response whose JSON root is %s",
  async (body) => {
    const fetcher = vi.fn().mockResolvedValue(reply(body));
    const client = new GoogleDriveItemsClient(fetcher);
    await expect(client.readQuota("token")).resolves.toEqual({
      ok: false,
      code: "provider_unreachable",
      connectionProblem: null,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  },
);

it("sends writes with the expected metadata and binary content", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => reply({ id: "result" }));
  const client = new GoogleDriveItemsClient(fetcher);
  await client.createFolder("token", { name: "Folder", parentId: "parent" });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    name: "Folder",
    parents: ["parent"],
    mimeType: "application/vnd.google-apps.folder",
  });
  expect(fetcher.mock.calls[0][1].headers["Content-Type"]).toBe(
    "application/json; charset=UTF-8",
  );
  await client.upload("token", {
    name: "note.txt",
    parentId: "parent",
    mimeType: "text/plain",
    content: Buffer.from("hello"),
  });
  expect(fetcher.mock.calls[1][1].headers["Content-Type"]).toMatch(
    /^multipart\/related; boundary=pages-[a-f0-9]+$/u,
  );
  expect(Buffer.from(fetcher.mock.calls[1][1].body).toString()).toContain(
    '"parents":["parent"]',
  );
  expect(Buffer.from(fetcher.mock.calls[1][1].body).toString()).toContain(
    "hello",
  );
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get("uploadType")).toBe(
    "multipart",
  );
  const bytes = new Uint8Array([1, 2]);
  await client.replaceContent("token", "id", {
    mimeType: "application/octet-stream",
    bytes,
  });
  expect(fetcher.mock.calls[2][1]).toMatchObject({
    method: "PATCH",
    body: bytes,
    headers: { "Content-Type": "application/octet-stream" },
  });
  await client.change("token", "id", {
    name: "Renamed",
    isTrashed: false,
    addParentId: "new",
    removeParentId: "old",
  });
  expect(JSON.parse(fetcher.mock.calls[3][1].body)).toEqual({
    name: "Renamed",
    trashed: false,
  });
  expect(new URL(fetcher.mock.calls[3][0]).searchParams.get("addParents")).toBe(
    "new",
  );
  expect(
    new URL(fetcher.mock.calls[3][0]).searchParams.get("removeParents"),
  ).toBe("old");
  await client.change("token", "id", {});
  expect(JSON.parse(fetcher.mock.calls[4][1].body)).toEqual({});
  await client.copy("token", "id", { name: "Copy", parentId: "parent" });
  expect(JSON.parse(fetcher.mock.calls[5][1].body)).toEqual({
    name: "Copy",
    parents: ["parent"],
  });
  await expect(client.remove("token", "id")).resolves.toEqual({
    ok: true,
    value: null,
  });
  expect(fetcher.mock.calls[6][1].method).toBe("DELETE");
});

it("streams downloads and exports with optional response metadata", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("hello", {
        headers: { "Content-Type": "text/plain", "Content-Length": "5" },
      }),
    )
    .mockResolvedValueOnce(new Response("document"))
    .mockResolvedValueOnce(
      new Response("bad", { headers: { "Content-Length": "invalid" } }),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array([1])));
  const client = new GoogleDriveItemsClient(fetcher);
  const download = await client.download("token", "id/name");
  expect(download).toMatchObject({
    ok: true,
    value: { mimeType: "text/plain", sizeBytes: 5 },
  });
  if (!download.ok || !download.value.body)
    throw new Error("Missing download stream");
  expect(await new Response(download.value.body).text()).toBe("hello");
  expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe(
    "/drive/v3/files/id%2Fname",
  );
  await expect(
    client.export("token", "doc", "text/plain"),
  ).resolves.toMatchObject({ ok: true, value: { sizeBytes: null } });
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get("mimeType")).toBe(
    "text/plain",
  );
  await expect(client.download("token", "id")).resolves.toMatchObject({
    ok: true,
    value: { sizeBytes: null },
  });
  await expect(client.download("token", "id")).resolves.toMatchObject({
    ok: true,
    value: { mimeType: "application/octet-stream", sizeBytes: null },
  });
});

it.each([
  [401, "", "connection_unavailable", "access_revoked"],
  [403, "accessNotConfigured", "connection_unavailable", "drive_api_disabled"],
  [404, "", "not_found", null],
  [403, "insufficientPermissions", "provider_scope_missing", null],
  [403, "insufficientScopes", "provider_scope_missing", null],
  [403, "fileNotDownloadable", "unsupported_operation", null],
  [400, "badRequest", "unsupported_operation", null],
  [413, "", "too_large", null],
  [403, "uploadTooLarge", "too_large", null],
  [403, "other", "provider_forbidden", null],
  [403, "rateLimitExceeded", "provider_unreachable", null],
  [400, "", "invalid_request", null],
  [500, "", "provider_unreachable", null],
])(
  "classifies refusal %s %s",
  async (status, reason, code, connectionProblem) => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        reply({ error: { errors: [{ reason }] } }, status),
      );
    const client = new GoogleDriveItemsClient(fetcher);
    const expected = { ok: false, code, connectionProblem };
    await expect(client.stat("token", "id")).resolves.toEqual(expected);
    await expect(client.download("token", "id")).resolves.toEqual(expected);
    await expect(client.remove("token", "id")).resolves.toEqual(expected);
  },
);

it("handles unavailable requests and default fetch", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  try {
    const client = new GoogleDriveItemsClient();
    const expected = {
      ok: false,
      code: "provider_unreachable",
      connectionProblem: null,
    };
    await expect(client.stat("token", "id")).resolves.toEqual(expected);
    await expect(client.download("token", "id")).resolves.toEqual(expected);
    await expect(client.remove("token", "id")).resolves.toEqual(expected);
  } finally {
    vi.unstubAllGlobals();
  }
});
