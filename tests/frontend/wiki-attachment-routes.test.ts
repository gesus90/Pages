import { Readable } from "node:stream";

import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  describeUploadFailure,
  readBody,
  toUploadedFile,
} from "@/app/lib/wiki-actions/wiki-upload.server";
import { action as uploadAction } from "@/app/routes/wiki-attachments";
import { loader as downloadLoader } from "@/app/routes/wiki-attachment";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";

import { createUser } from "../helpers/factories";

const user = createUser();
const openAttachment = vi.fn();
const uploadAttachment = vi.fn();

function context(actor: typeof user | null): RouterContextProvider {
  const provider = new RouterContextProvider();

  if (actor) {
    provider.set(authenticatedUserContext, actor);
  }

  return provider;
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString();
}

beforeEach(() => {
  vi.mocked(getApplicationServices).mockResolvedValue({
    wikiService: { openAttachment, uploadAttachment },
  } as never);
});

describe("attachment download", () => {
  function attachment(overrides: Record<string, unknown> = {}) {
    return {
      attachment: {
        contentType: "image/png",
        fileName: "Größe.png",
        isEmbeddable: true,
        size: 5,
        ...overrides,
      },
      stream: Readable.from([Buffer.from("bytes")]),
    };
  }

  const ask = (query = "", actor: typeof user | null = user) =>
    ({
      context: context(actor),
      params: { attachmentId: "a1" },
      request: new Request(`http://localhost/wiki/attachments/a1${query}`),
    }) as never;

  it("shows a raster image inline with the type found in its bytes", async () => {
    openAttachment.mockResolvedValue(attachment());

    const response = await downloadLoader(ask());

    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toMatch(/^inline;/);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "sandbox",
    );
    expect(response.headers.get("Content-Length")).toBe("5");
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(await response.text()).toBe("bytes");
  });

  it("sends images as a download on request and everything else always", async () => {
    openAttachment.mockResolvedValue(attachment());
    expect(
      (await downloadLoader(ask("?download=1"))).headers.get(
        "Content-Disposition",
      ),
    ).toMatch(/^attachment;/);

    openAttachment.mockResolvedValue(
      attachment({
        contentType: "application/octet-stream",
        fileName: "page.html",
        isEmbeddable: false,
      }),
    );

    const response = await downloadLoader(ask());

    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
  });

  it("answers a hidden file like a missing one and passes other failures on", async () => {
    openAttachment.mockRejectedValueOnce(new WikiPageNotFoundError());
    await expect(downloadLoader(ask())).rejects.toMatchObject({ status: 404 });

    openAttachment.mockRejectedValueOnce(new Error("boom"));
    await expect(downloadLoader(ask())).rejects.toThrow("boom");
    await expect(downloadLoader(ask("", null))).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("attachment upload", () => {
  const put = (
    body: BodyInit | null = "data",
    query = "?page=p1&name=a.txt",
    method = "PUT",
    headers: Record<string, string> = {},
  ) =>
    ({
      context: context(user),
      request: new Request(`http://localhost/wiki-api/attachments${query}`, {
        body,
        // Node needs this to accept a streaming body.
        duplex: "half",
        headers,
        method,
      } as RequestInit),
    }) as never;

  it("hands the streamed file to the service", async () => {
    uploadAttachment.mockImplementation(async (_actor, _page, file) => {
      expect(await collect(file.body)).toBe("data");

      return { id: "a1" };
    });

    const response = await uploadAction(
      put("data", "?page=p1&name=a.txt", "PUT", { "content-length": "4" }),
    );

    expect(await response.json()).toEqual({ attachment: { id: "a1" } });
    expect(uploadAttachment).toHaveBeenCalledWith(
      user,
      "p1",
      expect.objectContaining({ contentLength: 4, fileName: "a.txt" }),
    );
  });

  it("treats a missing body and missing parameters as empty", async () => {
    uploadAttachment.mockImplementation(async (_actor, _page, file) => ({
      text: await collect(file.body),
    }));

    expect(await (await uploadAction(put(null, ""))).json()).toEqual({
      attachment: { text: "" },
    });
    expect(uploadAttachment).toHaveBeenLastCalledWith(
      user,
      "",
      expect.objectContaining({ contentLength: null, fileName: "" }),
    );
  });

  it("maps refusals to status codes and passes other failures on", async () => {
    const reply = async (error: Error) => {
      uploadAttachment.mockRejectedValueOnce(error);

      const response = await uploadAction(put());

      return [response.status, await response.json()];
    };

    expect(await reply(new WikiValidationError("fileTooLarge"))).toEqual([
      413,
      { error: "fileTooLarge" },
    ]);
    expect(await reply(new WikiValidationError("fileEmpty"))).toEqual([
      400,
      { error: "fileEmpty" },
    ]);
    expect(await reply(new WikiPageNotFoundError())).toEqual([
      404,
      { error: "notFound" },
    ]);
    expect(await reply(new WikiAccessDeniedError())).toEqual([
      403,
      { error: "forbidden" },
    ]);

    uploadAttachment.mockRejectedValueOnce(new Error("boom"));
    await expect(uploadAction(put())).rejects.toThrow("boom");
  });

  it("refuses other methods and anonymous requests", async () => {
    await expect(uploadAction(put(null, "", "POST"))).rejects.toMatchObject({
      status: 405,
    });
    await expect(
      uploadAction({
        context: context(null),
        request: new Request("http://x", { method: "PUT" }),
      } as never),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("upload helpers", () => {
  it("reads a stream in chunks and releases it", async () => {
    const stream = new Blob(["abc"]).stream();

    expect(await collect(readBody(stream))).toBe("abc");
    expect(stream.locked).toBe(false);
  });

  it("describes failures only for the ones that are the person's doing", () => {
    expect(describeUploadFailure(new Error("x"))).toBeNull();
    expect(describeUploadFailure("text")).toBeNull();
    expect(
      toUploadedFile(new Request("http://x", { method: "PUT" }), "n")
        .contentLength,
    ).toBeNull();
    expect(
      toUploadedFile(
        new Request("http://x", {
          headers: { "content-length": "0" },
          method: "PUT",
        }),
        "n",
      ).contentLength,
    ).toBeNull();
  });
});
