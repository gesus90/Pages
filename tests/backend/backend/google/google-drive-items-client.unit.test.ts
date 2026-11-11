import { describe, expect, it, vi } from "vitest";

import {
  escapeDriveLiteral,
  GoogleDriveItemsClient,
  toStorageEntry,
} from "@/backend/google/GoogleDriveItemsClient";

import type { GoogleFetch } from "@/backend/google/GoogleDriveResponses";

describe("GoogleDriveItemsClient mapping", () => {
  it("escapes query literals and validates file resources", () => {
    expect(escapeDriveLiteral("a\\b'c")).toBe("a\\\\b\\'c");
    expect(toStorageEntry(null)).toBeNull();
    expect(toStorageEntry({ name: "missing" })).toBeNull();
    expect(
      toStorageEntry({
        id: "a",
        mimeType: "application/vnd.google-apps.folder",
        size: "-1",
        webViewLink: "http://unsafe",
        parents: [42],
      }),
    ).toMatchObject({
      ref: "a",
      isFolder: true,
      sizeBytes: null,
      parentRef: null,
      webViewLink: null,
    });
    expect(
      toStorageEntry({
        id: "doc",
        mimeType: "application/vnd.google-apps.document",
        size: "12",
        parents: ["root"],
        webViewLink: "https://example.test/doc",
        trashed: true,
        explicitlyTrashed: true,
      }),
    ).toMatchObject({
      isGoogleDocument: true,
      sizeBytes: 12,
      parentRef: "root",
      isTrashed: true,
      isExplicitlyTrashed: true,
      webViewLink: "https://example.test/doc",
    });
  });

  it("sends a query with drive and pagination parameters and filters malformed entries", async () => {
    const fetcher = vi.fn<GoogleFetch>().mockResolvedValue(
      Response.json({
        files: [{ id: "one", name: "One" }, {}, null],
        nextPageToken: "next",
      }),
    );
    const client = new GoogleDriveItemsClient(fetcher);
    const result = await client.query("token", {
      query: "name = 'One'",
      driveId: "shared",
      pageToken: "cursor",
      pageSize: 25,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { entries: [{ ref: "one", name: "One" }], nextPageToken: "next" },
    });
    const [address, init] = fetcher.mock.calls[0];
    const url = new URL(address);
    expect(url.searchParams.get("q")).toBe("name = 'One'");
    expect(url.searchParams.get("corpora")).toBe("drive");
    expect(url.searchParams.get("driveId")).toBe("shared");
    expect(url.searchParams.get("pageToken")).toBe("cursor");
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { Authorization: "Bearer token" },
    });
  });
});

describe("GoogleDriveItemsClient listings", () => {
  it("maps shared drives and quota, and rejects malformed successful answers", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ drives: [{ id: "team", name: "Team" }, {}] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          storageQuota: {
            limit: "100",
            usage: "20",
            usageInDrive: "18",
            usageInDriveTrash: "2",
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ files: null }));
    const client = new GoogleDriveItemsClient(fetcher);
    expect(
      await client.listSharedDrives("t", { pageSize: 200, pageToken: "p" }),
    ).toMatchObject({
      ok: true,
      value: {
        entries: [{ ref: "team", driveRef: "team", isFolder: true }],
        nextPageToken: null,
      },
    });
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("pageSize")).toBe(
      "100",
    );
    expect(await client.readQuota("t")).toEqual({
      ok: true,
      value: {
        limitBytes: 100,
        usageBytes: 20,
        usageInDriveBytes: 18,
        usageInTrashBytes: 2,
      },
    });
    expect(
      await client.query("t", {
        query: "",
        driveId: null,
        pageSize: 10,
        pageToken: null,
      }),
    ).toEqual({
      ok: false,
      code: "provider_unreachable",
      connectionProblem: null,
    });
  });
});

describe("GoogleDriveItemsClient requests", () => {
  it.each([
    [401, "", "connection_unavailable", "access_revoked"],
    [
      403,
      "accessNotConfigured",
      "connection_unavailable",
      "drive_api_disabled",
    ],
    [404, "", "not_found", null],
    [403, "insufficientScopes", "provider_scope_missing", null],
    [403, "fileNotDownloadable", "unsupported_operation", null],
    [413, "", "too_large", null],
    [403, "", "provider_forbidden", null],
    [403, "rateLimitExceeded", "provider_unreachable", null],
    [400, "", "invalid_request", null],
  ])(
    "translates status %i and reason %s",
    async (status, reason, code, connectionProblem) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { errors: [{ reason }] } }, { status }),
        );
      expect(
        await new GoogleDriveItemsClient(fetcher).stat("t", "file"),
      ).toEqual({ ok: false, code, connectionProblem });
    },
  );

  it("constructs metadata writes and deletes with encoded identifiers", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => Response.json({ id: "result" }));
    const client = new GoogleDriveItemsClient(fetcher);
    await client.createFolder("t", { name: "Folder", parentId: "root" });
    await client.change("t", "a/b", {
      name: "Renamed",
      isTrashed: false,
      addParentId: "new",
      removeParentId: "old",
    });
    await client.copy("t", "a/b", { name: "Copy", parentId: "new" });
    expect(await client.remove("t", "a/b")).toEqual({ ok: true, value: null });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      mimeType: "application/vnd.google-apps.folder",
      name: "Folder",
      parents: ["root"],
    });
    const changedUrl = new URL(fetcher.mock.calls[1][0]);
    expect(changedUrl.pathname).toContain("a%2Fb");
    expect(changedUrl.searchParams.get("addParents")).toBe("new");
    expect(changedUrl.searchParams.get("removeParents")).toBe("old");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      name: "Renamed",
      trashed: false,
    });
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
      name: "Copy",
      parents: ["new"],
    });
    expect(fetcher.mock.calls[3][1].method).toBe("DELETE");
  });
});

describe("GoogleDriveItemsClient transfers", () => {
  it("uploads and replaces bytes with their content types", async () => {
    const fetcher = vi
      .fn<GoogleFetch>()
      .mockImplementation(async () => Response.json({ id: "file" }));
    const client = new GoogleDriveItemsClient(fetcher);
    await client.upload("t", {
      name: "note.txt",
      mimeType: "text/plain",
      parentId: "root",
      content: new Uint8Array([65, 66]),
    });
    await client.replaceContent("t", "file", {
      mimeType: "text/plain",
      bytes: new Uint8Array([67]),
    });
    const upload = fetcher.mock.calls[0][1];
    expect(new Headers(upload.headers).get("Content-Type")).toMatch(
      /^multipart\/related; boundary=pages-/u,
    );
    expect(upload.body).toBeInstanceOf(Uint8Array);
    if (!(upload.body instanceof Uint8Array))
      throw new Error("Missing upload bytes");
    expect(Buffer.from(upload.body).toString()).toContain('"parents":["root"]');
    expect(Buffer.from(upload.body).toString()).toContain("AB");
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "text/plain" },
      body: new Uint8Array([67]),
    });
  });

  it("streams downloads and exports and reports network failures", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("abc", {
          headers: { "Content-Type": "text/plain", "Content-Length": "3" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("pdf", { headers: { "Content-Length": "invalid" } }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    const client = new GoogleDriveItemsClient(fetcher);
    const download = await client.download("t", "a/b");
    expect(download).toMatchObject({
      ok: true,
      value: { mimeType: "text/plain", sizeBytes: 3 },
    });
    if (download.ok)
      expect(await new Response(download.value.body).text()).toBe("abc");
    expect(await client.export("t", "doc", "application/pdf")).toMatchObject({
      ok: true,
      value: { sizeBytes: null },
    });
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get("mimeType")).toBe(
      "application/pdf",
    );
    expect(await client.remove("t", "file")).toEqual({
      ok: false,
      code: "provider_unreachable",
      connectionProblem: null,
    });
  });
});
