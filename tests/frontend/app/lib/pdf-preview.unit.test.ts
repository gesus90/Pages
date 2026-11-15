import { beforeEach, describe, expect, it, vi } from "vitest";

import { openPdfPreview } from "@/app/lib/pdf-preview";

const pdf = vi.hoisted(() => {
  const state = {
    document: { numPages: 3, getPage: vi.fn() },
    task: {
      promise: Promise.resolve<unknown>(null),
      destroy: vi.fn(async () => undefined),
    },
    getDocument: vi.fn(),
    workers: 0,
  };
  return state;
});

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?worker", () => ({
  default: class {
    public constructor() {
      pdf.workers += 1;
    }
  },
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  AnnotationMode: { DISABLE: 0 },
  getDocument: pdf.getDocument,
}));

interface FakePage {
  readonly getViewport: ReturnType<typeof vi.fn>;
  readonly render: ReturnType<typeof vi.fn>;
  readonly cleanup: ReturnType<typeof vi.fn>;
}

function fakePage(
  render: () => { promise: Promise<void>; cancel: () => void },
): FakePage {
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 200 * scale,
      height: 300 * scale,
    })),
    render: vi.fn(render),
    cleanup: vi.fn(),
  };
}

function resolvedRender(): { promise: Promise<void>; cancel: () => void } {
  return { promise: Promise.resolve(), cancel: vi.fn() };
}

/** A promise the test settles by hand. */
interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
  readonly fail: (reason: Error) => void;
}

function gateOf(): Gate {
  const handles = {
    open: (): void => undefined,
    fail: (): void => undefined,
  };
  const promise = new Promise<void>((resolve, reject) => {
    handles.open = resolve;
    handles.fail = reject;
  });
  return { promise, ...handles };
}

function canvas(): HTMLCanvasElement {
  const element = { width: 0, height: 0 };
  return element as HTMLCanvasElement;
}

beforeEach(() => {
  pdf.document = { numPages: 3, getPage: vi.fn() };
  pdf.task = {
    promise: Promise.resolve(pdf.document),
    destroy: vi.fn(async () => undefined),
  };
  pdf.getDocument.mockReturnValue(pdf.task);
  vi.stubGlobal("window", { devicePixelRatio: 2 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })),
  );
});

describe("opening a pdf preview", () => {
  it("loads the bytes without fetching scripts or forms and reports the page count", async () => {
    const signal = new AbortController().signal;

    const preview = await openPdfPreview("/a.pdf", signal);

    expect(fetch).toHaveBeenCalledWith("/a.pdf", { signal });
    expect(pdf.getDocument).toHaveBeenCalledWith({
      data: new Uint8Array([1, 2, 3]),
      enableXfa: false,
      useWasm: false,
      stopAtErrors: false,
    });
    expect(preview.pageCount).toBe(3);
  });

  it("refuses an answer that is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );

    await expect(
      openPdfPreview("/a.pdf", new AbortController().signal),
    ).rejects.toThrow("The PDF could not be loaded.");
  });

  it("releases the task when the document cannot be parsed", async () => {
    const failure = new Error("corrupt");
    pdf.task = {
      promise: Promise.reject(failure),
      destroy: vi.fn(async () => undefined),
    };
    pdf.getDocument.mockReturnValue(pdf.task);

    await expect(
      openPdfPreview("/a.pdf", new AbortController().signal),
    ).rejects.toBe(failure);

    expect(pdf.task.destroy).toHaveBeenCalledOnce();
  });

  it("shares one worker between previews and destroys the task on close", async () => {
    const first = await openPdfPreview("/a.pdf", new AbortController().signal);
    await openPdfPreview("/b.pdf", new AbortController().signal);

    first.close();

    expect(pdf.workers).toBeLessThanOrEqual(1);
    expect(pdf.task.destroy).toHaveBeenCalledOnce();
  });
});

describe("rendering a page", () => {
  it("scales the page to the width and the device pixel ratio and cleans up", async () => {
    const page = fakePage(resolvedRender);
    pdf.document.getPage.mockResolvedValue(page);
    const preview = await openPdfPreview(
      "/a.pdf",
      new AbortController().signal,
    );
    const target = canvas();

    await preview.render(2, target, 100);

    expect(pdf.document.getPage).toHaveBeenCalledWith(2);
    // 100 px wide on a 200 px page at pixel ratio 2 means scale 1.
    expect(target.width).toBe(200);
    expect(target.height).toBe(300);
    expect(page.render).toHaveBeenCalledWith({
      canvas: target,
      viewport: { width: 200, height: 300 },
      annotationMode: 0,
    });
    expect(page.cleanup).toHaveBeenCalledOnce();
  });

  it("uses a pixel ratio of one when the device reports none", async () => {
    vi.stubGlobal("window", { devicePixelRatio: 0 });
    pdf.document.getPage.mockResolvedValue(fakePage(resolvedRender));
    const preview = await openPdfPreview(
      "/a.pdf",
      new AbortController().signal,
    );
    const target = canvas();

    await preview.render(1, target, 100);

    expect(target.width).toBe(100);
  });
});

describe("rendering pages on one canvas", () => {
  it("cancels the render that still runs on the same canvas before it starts a new one", async () => {
    const gate = gateOf();
    const cancel = vi.fn(() => gate.fail(new Error("cancelled")));
    const first = fakePage(() => ({
      promise: gate.promise,
      cancel,
    }));
    const second = fakePage(resolvedRender);
    pdf.document.getPage
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const preview = await openPdfPreview(
      "/a.pdf",
      new AbortController().signal,
    );
    const target = canvas();

    const running = preview.render(1, target, 100);
    await vi.waitFor(() => expect(first.render).toHaveBeenCalled());
    await preview.render(2, target, 100);

    await expect(running).rejects.toThrow("cancelled");
    expect(cancel).toHaveBeenCalledOnce();
    expect(first.cleanup).toHaveBeenCalledOnce();
    expect(second.cleanup).toHaveBeenCalledOnce();
  });

  it("keeps the newer render of a canvas registered when an older one ends late", async () => {
    const gate = gateOf();
    const older = fakePage(() => ({ promise: gate.promise, cancel: vi.fn() }));
    const cancelNewer = vi.fn();
    const newer = fakePage(() => ({
      promise: new Promise<void>(() => undefined),
      cancel: cancelNewer,
    }));
    pdf.document.getPage
      .mockResolvedValueOnce(older)
      .mockResolvedValueOnce(newer);
    const preview = await openPdfPreview(
      "/a.pdf",
      new AbortController().signal,
    );
    const target = canvas();

    const first = preview.render(1, target, 100);
    void preview.render(2, target, 100);
    await vi.waitFor(() => expect(newer.render).toHaveBeenCalled());
    gate.open();
    await first;
    const third = fakePage(resolvedRender);
    pdf.document.getPage.mockResolvedValueOnce(third);
    const pending = preview.render(3, target, 100);
    await vi.waitFor(() => expect(cancelNewer).toHaveBeenCalled());

    expect(older.cleanup).toHaveBeenCalledOnce();
    void pending;
  });

  it("cleans up even when the render fails, and forgets it", async () => {
    const failure = new Error("render failed");
    const page = fakePage(() => ({
      promise: Promise.reject(failure),
      cancel: vi.fn(),
    }));
    pdf.document.getPage.mockResolvedValue(page);
    const preview = await openPdfPreview(
      "/a.pdf",
      new AbortController().signal,
    );

    await expect(preview.render(1, canvas(), 100)).rejects.toBe(failure);

    expect(page.cleanup).toHaveBeenCalledOnce();
  });
});
