import { describe, expect, it, vi } from "vitest";

import {
  TicketUploadError,
  isTicketAttachmentPath,
  isTicketDisplayableImage,
  ticketAttachmentPath,
  uploadTicketFile,
} from "@/app/lib/ticket-upload";

import { stubUploadRequests } from "./upload-support";

import type { WorkItemAttachment } from "@/definition/Task";

const ATTACHMENT: WorkItemAttachment = {
  id: "att-1",
  workItemId: "ticket-1",
  fileName: "shot.png",
  contentType: "image/png",
  kind: "media",
  size: 10,
  isEmbeddable: true,
  uploadedBy: "u1",
  uploadedByName: "Ada",
  createdAt: "2026-01-01 00:00:00",
};

describe("ticket attachment paths", () => {
  it("recognizes a ticket attachment and builds its path", () => {
    expect(isTicketAttachmentPath("/aufgaben/attachments/abc-1")).toBe(true);
    expect(isTicketAttachmentPath("/aufgaben/attachments/abc-1?x=1#y")).toBe(
      true,
    );
    expect(isTicketAttachmentPath("/aufgaben/attachments/")).toBe(false);
    expect(isTicketAttachmentPath("/aufgaben/attachments/a/b")).toBe(false);
    expect(ticketAttachmentPath("att-1")).toBe("/aufgaben/attachments/att-1");
  });

  it("shows ticket and wiki attachments as images and nothing else", () => {
    expect(isTicketDisplayableImage("/aufgaben/attachments/a")).toBe(true);
    expect(isTicketDisplayableImage("/wiki/attachments/a")).toBe(true);
    expect(isTicketDisplayableImage("https://example.com/a.png")).toBe(false);
  });
});

describe("uploading a ticket file", () => {
  const file = new File(["data"], "my shot.png");

  it("puts the file to the ticket and resolves with the stored attachment", async () => {
    const requests = stubUploadRequests();
    const onProgress = vi.fn();

    const pending = uploadTicketFile("ticket 1", file, onProgress);
    const [request] = requests;
    request?.progress({ lengthComputable: true, loaded: 3, total: 4 });
    request?.progress({ lengthComputable: false, loaded: 0, total: 0 });
    request?.answer(201, JSON.stringify({ attachment: ATTACHMENT }));

    await expect(pending).resolves.toEqual(ATTACHMENT);
    expect(request?.method).toBe("PUT");
    expect(request?.address).toBe(
      "/aufgaben-api/attachments?ticket=ticket%201&name=my%20shot.png",
    );
    expect(request?.sent).toBe(file);
    expect(onProgress.mock.calls).toEqual([[0.75], [0]]);
  });

  it("rejects with the error code the server sends", async () => {
    const requests = stubUploadRequests();

    const pending = uploadTicketFile("t", file, vi.fn());
    requests[0]?.answer(403, JSON.stringify({ error: "forbidden" }));

    await expect(pending).rejects.toMatchObject({
      name: "TicketUploadError",
      code: "forbidden",
      message: "Ticket upload failed: forbidden",
    });
  });

  it.each([
    { label: "a success without attachment", status: 200, body: "{}" },
    { label: "an unreadable answer", status: 502, body: "oops" },
    { label: "a non-object answer", status: 200, body: "7" },
    {
      label: "an attachment on a failing status",
      status: 500,
      body: JSON.stringify({ attachment: ATTACHMENT }),
    },
  ])("rejects with the network code for $label", async ({ status, body }) => {
    const requests = stubUploadRequests();

    const pending = uploadTicketFile("t", file, vi.fn());
    requests[0]?.answer(status, body);

    await expect(pending).rejects.toBeInstanceOf(TicketUploadError);
    await expect(pending).rejects.toMatchObject({ code: "network" });
  });

  it("rejects with the network code when the request fails", async () => {
    const requests = stubUploadRequests();

    const pending = uploadTicketFile("t", file, vi.fn());
    requests[0]?.fail();

    await expect(pending).rejects.toMatchObject({ code: "network" });
  });
});
