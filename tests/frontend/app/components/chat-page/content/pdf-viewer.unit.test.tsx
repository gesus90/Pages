import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { PdfViewer } from "@/app/components/chat-page/content/pdf-viewer";
import { createI18n } from "@/app/lib/i18n";

const pdf = vi.hoisted(() => ({
  open: vi.fn(),
  render: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@/app/lib/pdf-preview", () => ({ openPdfPreview: pdf.open }));

class VisibleObserver implements IntersectionObserver {
  public readonly root = null;
  public readonly rootMargin = "";
  public readonly scrollMargin = "";
  public readonly thresholds: readonly number[] = [];
  private readonly callback: IntersectionObserverCallback;

  /** Receives visibility changes for the simulated thumbnails. */
  public constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  /** Makes each thumbnail visible as soon as it is observed. */
  public observe(target: Element): void {
    const rect = target.getBoundingClientRect();
    const entry: IntersectionObserverEntry = {
      target,
      isIntersecting: true,
      boundingClientRect: rect,
      intersectionRatio: 1,
      intersectionRect: rect,
      rootBounds: null,
      time: 0,
    };
    this.callback([entry], this);
  }

  /** No resources are retained by the simulated observer. */
  public disconnect(): void {}

  /** No resources are retained for individual targets. */
  public unobserve(): void {}

  /** The observer delivers changes immediately. */
  public takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeEach(() => {
  pdf.open.mockReset();
  pdf.render.mockReset().mockResolvedValue(undefined);
  pdf.close.mockReset();
  vi.stubGlobal("IntersectionObserver", VisibleObserver);
  Element.prototype.scrollTo = vi.fn();
});

function viewer(url = "/one.pdf", onPageCount = vi.fn()): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n("en")}>
      <PdfViewer url={url} onPageCount={onPageCount} />
    </I18nextProvider>
  );
}

it("opens pages, navigates by controls and keys, and changes zoom", async () => {
  pdf.open.mockResolvedValue({
    pageCount: 3,
    render: pdf.render,
    close: pdf.close,
  });
  const onPageCount = vi.fn();
  const { container, unmount } = render(viewer("/one.pdf", onPageCount));
  await waitFor(() => expect(onPageCount).toHaveBeenCalledWith(3));
  expect(pdf.open).toHaveBeenCalledWith("/one.pdf", expect.any(AbortSignal));
  expect(screen.getByText("Page 1 / 3")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("Page 2 / 3")).toBeTruthy();
  const root = container.querySelector("[tabindex='0']");
  if (!root) throw new Error("Viewer is missing");
  fireEvent.keyDown(root, { key: "PageDown" });
  expect(screen.getByText("Page 3 / 3")).toBeTruthy();
  fireEvent.keyDown(root, { key: "ArrowLeft" });
  expect(screen.getByText("Page 2 / 3")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByText("125 %")).toBeTruthy();
  await waitFor(() =>
    expect(pdf.render).toHaveBeenCalledWith(
      2,
      expect.any(HTMLCanvasElement),
      expect.any(Number),
    ),
  );
  unmount();
  expect(pdf.close).toHaveBeenCalledOnce();
});

it("reports a failed document and keeps controls disabled", async () => {
  pdf.open.mockRejectedValue(new Error("failed"));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  render(viewer());
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(
    screen
      .getAllByRole("button")
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
  expect(warning).toHaveBeenCalled();
});

it("closes a document that finishes opening after unmount", async () => {
  let resolveOpen: (preview: {
    pageCount: number;
    render: typeof pdf.render;
    close: typeof pdf.close;
  }) => void = () => undefined;
  pdf.open.mockReturnValue(
    new Promise((resolve) => {
      resolveOpen = resolve;
    }),
  );
  const { unmount } = render(viewer());
  await waitFor(() => expect(pdf.open).toHaveBeenCalled());
  unmount();
  resolveOpen({ pageCount: 1, render: pdf.render, close: pdf.close });
  await waitFor(() => expect(pdf.close).toHaveBeenCalledOnce());
});
