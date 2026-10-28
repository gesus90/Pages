import { expect, it, vi } from "vitest";

import { runnerAssetUpload } from "@/app/lib/agent-asset-return.server";

import { servicesOf } from "../actions/action-fixtures";

const ASSET = { assetId: "asset", link: "/asset", fileName: "a.png" };
const RETURN_REQUEST = { returnId: "return", credentialHash: "hash" };

interface UploadFakes {
  readonly consume: ReturnType<typeof vi.fn>;
  readonly upload: ReturnType<typeof vi.fn>;
  readonly uploadWiki: ReturnType<typeof vi.fn>;
  readonly uploadAsset: ReturnType<typeof vi.fn>;
  readonly received: Buffer[];
}

function uploadFakes(authority: object): UploadFakes {
  const received: Buffer[] = [];
  async function readBody(file: {
    readonly body: AsyncIterable<Buffer>;
  }): Promise<typeof ASSET> {
    for await (const chunk of file.body) received.push(chunk);
    return ASSET;
  }
  return {
    consume: vi.fn(async () => authority),
    upload: vi.fn(readBody),
    uploadWiki: vi.fn(readBody),
    uploadAsset: vi.fn(readBody),
    received,
  };
}

function uploadWith(fakes: UploadFakes): (ticket: string) => Promise<unknown> {
  const services = servicesOf({
    agentUploadTicketService: { consume: fakes.consume },
    agentTicketUploadService: {
      upload: fakes.upload,
      uploadWiki: fakes.uploadWiki,
    },
    agentAssetService: { upload: fakes.uploadAsset },
  });
  const upload = runnerAssetUpload(async () => services);
  return (ticket) => upload(ticket, Buffer.from("bytes"));
}

it("returns a wiki page asset when the ticket names a page and a return request", async () => {
  const revalidate = vi.fn();
  const fakes = uploadFakes({
    fileName: "a.png",
    pageId: "page",
    request: RETURN_REQUEST,
    revalidate,
  });

  await expect(uploadWith(fakes)("ticket-1")).resolves.toBe(ASSET);

  expect(fakes.consume).toHaveBeenCalledWith("ticket-1");
  expect(fakes.uploadWiki).toHaveBeenCalledWith(
    expect.objectContaining({ fileName: "a.png", contentLength: 5 }),
    revalidate,
    "page",
    RETURN_REQUEST,
  );
  expect(fakes.received).toEqual([Buffer.from("bytes")]);
  expect(fakes.upload).not.toHaveBeenCalled();
  expect(fakes.uploadAsset).not.toHaveBeenCalled();
});

it("attaches to the ticket when a page is named without a return request", async () => {
  const revalidate = vi.fn();
  const fakes = uploadFakes({
    fileName: "b.txt",
    pageId: "page",
    ticketId: "PAGE-1",
    revalidate,
  });

  await expect(uploadWith(fakes)("ticket-2")).resolves.toBe(ASSET);

  expect(fakes.uploadWiki).not.toHaveBeenCalled();
  expect(fakes.upload).toHaveBeenCalledWith(
    expect.objectContaining({ fileName: "b.txt", contentLength: 5 }),
    revalidate,
    "PAGE-1",
    undefined,
  );
  expect(fakes.received).toEqual([Buffer.from("bytes")]);
});

it("stores a free agent asset when the ticket names no destination", async () => {
  const revalidate = vi.fn();
  const fakes = uploadFakes({ fileName: "c.pdf", revalidate });

  await expect(uploadWith(fakes)("ticket-3")).resolves.toBe(ASSET);

  expect(fakes.upload).not.toHaveBeenCalled();
  expect(fakes.uploadWiki).not.toHaveBeenCalled();
  expect(fakes.uploadAsset).toHaveBeenCalledWith(
    expect.objectContaining({ fileName: "c.pdf", contentLength: 5 }),
    revalidate,
  );
  expect(fakes.received).toEqual([Buffer.from("bytes")]);
});
