// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isTicketAttachmentPath,
  isTicketDisplayableImage,
  ticketAttachmentPath,
  TicketUploadError,
  uploadTicketFile,
} from "@/app/lib/ticket-upload";

const ATTACHMENT = { fileName: "a.txt", id: "a1" };

class FakeRequest {
  public static instances: FakeRequest[] = [];
  public static next: { status: number; body: string } | "error" = {
    body: JSON.stringify({ attachment: ATTACHMENT }),
    status: 200,
  };

  public method = "";
  public url = "";
  public sent: unknown = null;
  public status = 0;
  public responseText = "";
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };

  public constructor() {
    FakeRequest.instances.push(this);
  }

  public open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  public send(body: unknown): void {
    this.sent = body;
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 1,
      total: 4,
    } as ProgressEvent);
    this.upload.onprogress?.({
      lengthComputable: false,
      loaded: 0,
      total: 0,
    } as ProgressEvent);

    const answer = FakeRequest.next;

    queueMicrotask(() => {
      if (answer === "error") {
        this.onerror?.();

        return;
      }

      this.status = answer.status;
      this.responseText = answer.body;
      this.onload?.();
    });
  }
}

beforeEach(() => {
  FakeRequest.instances = [];
  FakeRequest.next = {
    body: JSON.stringify({ attachment: ATTACHMENT }),
    status: 200,
  };
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ticket upload", () => {
  it("knows the addresses of ticket attachments", () => {
    expect(ticketAttachmentPath("a1")).toBe("/aufgaben/attachments/a1");
    expect(isTicketAttachmentPath("/aufgaben/attachments/a1?download=1")).toBe(
      true,
    );
    expect(isTicketAttachmentPath("/aufgaben/PAGE-1")).toBe(false);
    expect(isTicketDisplayableImage("/wiki/attachments/w1")).toBe(true);
    expect(isTicketDisplayableImage("https://example.invalid/x.png")).toBe(
      false,
    );
  });

  it("sends the file as the body and reports the progress", async () => {
    const progress = vi.fn();
    const file = new File(["data"], "my file.txt");

    await expect(uploadTicketFile("t 1", file, progress)).resolves.toEqual(
      ATTACHMENT,
    );

    const [request] = FakeRequest.instances;

    expect(request?.method).toBe("PUT");
    expect(request?.url).toBe(
      "/aufgaben-api/attachments?ticket=t%201&name=my%20file.txt",
    );
    expect(request?.sent).toBe(file);
    expect(progress.mock.calls).toEqual([[0.25], [0]]);
  });

  it("names the reason the server gave and falls back to a network error", async () => {
    const file = new File(["data"], "a.txt");

    FakeRequest.next = {
      body: JSON.stringify({ error: "attachmentTooLarge" }),
      status: 413,
    };
    await expect(uploadTicketFile("t", file, vi.fn())).rejects.toMatchObject({
      code: "attachmentTooLarge",
      name: "TicketUploadError",
    });

    for (const body of ["not json", "null", JSON.stringify("text"), "{}"]) {
      FakeRequest.next = { body, status: 500 };
      await expect(uploadTicketFile("t", file, vi.fn())).rejects.toBeInstanceOf(
        TicketUploadError,
      );
    }

    FakeRequest.next = {
      body: JSON.stringify({ attachment: ATTACHMENT }),
      status: 500,
    };
    await expect(uploadTicketFile("t", file, vi.fn())).rejects.toMatchObject({
      code: "network",
    });

    FakeRequest.next = "error";
    await expect(uploadTicketFile("t", file, vi.fn())).rejects.toMatchObject({
      code: "network",
    });
  });
});
