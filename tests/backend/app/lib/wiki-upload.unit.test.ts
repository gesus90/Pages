import { describe, expect, it, vi } from "vitest";

import {
  WIKI_ATTACHMENT_PATH,
  WikiUploadError,
  formatAttachmentMarkdown,
  isWikiAttachmentPath,
  uploadWikiFile,
} from "@/app/lib/wiki-upload";

import { stubUploadRequests } from "./upload-support";

import type { WikiAttachment } from "@/definition/Wiki";

const ATTACHMENT: WikiAttachment = {
  id: "att-1",
  pageId: "page-1",
  fileName: "plan [v2].png",
  contentType: "image/png",
  kind: "media",
  size: 10,
  isEmbeddable: true,
  uploadedBy: "u1",
  uploadedByName: "Ada",
  createdAt: "2026-01-01 00:00:00",
};

describe("wiki attachment paths", () => {
  it.each(["/wiki/attachments/abc-1", "/agent-assets/x_y?download=1"])(
    "accepts %s",
    (path) => {
      expect(isWikiAttachmentPath(path)).toBe(true);
      expect(WIKI_ATTACHMENT_PATH.test(path)).toBe(true);
    },
  );

  it.each([
    "/wiki/attachments/",
    "/wiki/abc",
    "https://x.example/wiki/attachments/a",
    "/agent-assets/a/b",
  ])("refuses %s", (path) => {
    expect(isWikiAttachmentPath(path)).toBe(false);
  });
});

describe("uploading a wiki file", () => {
  const file = new File(["data"], "my file.txt");

  it("puts the file to the upload address and resolves with the stored attachment", async () => {
    const requests = stubUploadRequests();
    const onProgress = vi.fn();

    const pending = uploadWikiFile("page 1", file, onProgress);
    const [request] = requests;
    request?.progress({ lengthComputable: true, loaded: 1, total: 4 });
    request?.progress({ lengthComputable: false, loaded: 0, total: 0 });
    request?.answer(200, JSON.stringify({ attachment: ATTACHMENT }));

    await expect(pending).resolves.toEqual(ATTACHMENT);
    expect(request?.method).toBe("PUT");
    expect(request?.address).toBe(
      "/wiki-api/attachments?page=page%201&name=my%20file.txt",
    );
    expect(request?.sent).toBe(file);
    expect(onProgress.mock.calls).toEqual([[0.25], [0]]);
  });

  it("rejects with the error code the server sends", async () => {
    const requests = stubUploadRequests();

    const pending = uploadWikiFile("p", file, vi.fn());
    requests[0]?.answer(413, JSON.stringify({ error: "tooLarge" }));

    await expect(pending).rejects.toMatchObject({
      name: "WikiUploadError",
      code: "tooLarge",
    });
  });

  it.each([
    { label: "a success without attachment", status: 200, body: "{}" },
    { label: "an unreadable answer", status: 502, body: "<html>" },
    { label: "a non-object answer", status: 200, body: "null" },
    {
      label: "an attachment on a failing status",
      status: 500,
      body: JSON.stringify({ attachment: ATTACHMENT }),
    },
  ])("rejects with the network code for $label", async ({ status, body }) => {
    const requests = stubUploadRequests();

    const pending = uploadWikiFile("p", file, vi.fn());
    requests[0]?.answer(status, body);

    await expect(pending).rejects.toBeInstanceOf(WikiUploadError);
    await expect(pending).rejects.toMatchObject({
      code: "network",
      message: "Wiki upload failed: network",
    });
  });

  it("rejects with the network code when the request fails", async () => {
    const requests = stubUploadRequests();

    const pending = uploadWikiFile("p", file, vi.fn());
    requests[0]?.fail();

    await expect(pending).rejects.toMatchObject({ code: "network" });
  });
});

describe("attachment markdown", () => {
  it("embeds media and links files, escaping brackets and backslashes in the name", () => {
    expect(formatAttachmentMarkdown(ATTACHMENT)).toBe(
      "![plan \\[v2\\].png](/wiki/attachments/att-1)",
    );
    expect(
      formatAttachmentMarkdown({
        ...ATTACHMENT,
        isEmbeddable: false,
        fileName: "a\\b.pdf",
      }),
    ).toBe("[a\\\\b.pdf](/wiki/attachments/att-1)");
  });
});
