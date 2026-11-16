import { beforeEach, expect, it, vi } from "vitest";

const getDocument = vi.hoisted(() => vi.fn());
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument }));

import { readPdfDocument } from "@/backend/service/chat/ChatPdfText";

const cleanup = vi.fn();
const destroy = vi.fn();
const getPage = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 2, getPage }),
    destroy,
  });
  getPage.mockImplementation(async (number: number) => ({
    getTextContent: async () => ({
      items:
        number === 1
          ? [{ str: "Hello ", hasEOL: true }, { str: "World" }, {}]
          : [{ str: " " }],
    }),
    cleanup,
  }));
});

it("extracts page text without enabling network, fonts or scripts", async () => {
  expect(await readPdfDocument(Buffer.from("pdf"))).toMatchObject({
    status: "read",
    document: {
      sections: [{ kind: "page", number: 1, text: "Hello\nWorld" }],
      pages: { read: 2, total: 2 },
      isTruncated: false,
    },
  });
  expect(getDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      disableFontFace: true,
      useWasm: false,
      useWorkerFetch: false,
      enableXfa: false,
    }),
  );
  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(destroy).toHaveBeenCalledOnce();
});

it("reports scanned or encrypted PDFs without exposing parser errors", async () => {
  getPage.mockResolvedValue({
    getTextContent: async () => ({ items: [] }),
    cleanup,
  });
  expect(await readPdfDocument(Buffer.from("pdf"))).toEqual({
    status: "noText",
  });
  getDocument.mockReturnValueOnce({
    promise: Promise.reject(
      Object.assign(new Error("password"), { name: "PasswordException" }),
    ),
    destroy,
  });
  expect(await readPdfDocument(Buffer.from("pdf"))).toEqual({
    status: "encrypted",
  });
  getDocument.mockReturnValueOnce({
    promise: Promise.reject(new Error("invalid")),
    destroy,
  });
  expect(await readPdfDocument(Buffer.from("pdf"))).toEqual({
    status: "unreadable",
  });
});
