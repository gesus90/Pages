import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createThumbnail } from "@/app/components/chat-page/content/media-thumbnails";
import { PdfViewer } from "@/app/components/chat-page/content/pdf-viewer";
import { isPdfPasswordError } from "@/app/lib/pdf-errors";
import { createI18n } from "@/app/lib/i18n";

const pdf = vi.hoisted(() => ({
  open: vi.fn(),
  openBytes: vi.fn(),
  findPages: vi.fn(),
}));

vi.mock("@/app/lib/pdf-preview", () => ({ openPdfPreview: pdf.open, openPdfBytes: pdf.openBytes }));

class HiddenObserver {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
}

const i18n = createI18n("de");

function preview(): Record<string, unknown> {
  return {
    pageCount: 5,
    render: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
    readTitle: vi.fn(() => Promise.resolve("Quartalsbericht")),
    findPages: pdf.findPages,
  };
}

function passwordError(): Error {
  const error = new Error("No password given");
  error.name = "PasswordException";
  return error;
}

function Viewer({ isFullscreen = false }: { readonly isFullscreen?: boolean }): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <PdfViewer isFullscreen={isFullscreen} url="/chat/files/p1" />
    </I18nextProvider>
  );
}

beforeEach(() => {
  pdf.open.mockReset().mockResolvedValue(preview());
  pdf.openBytes.mockReset();
  pdf.findPages.mockReset().mockResolvedValue([2, 4]);
  vi.stubGlobal("IntersectionObserver", HiddenObserver);
  Element.prototype.scrollTo = vi.fn();
});

describe("the PDF viewer next to the chat and in the full screen (PAGE-385)", () => {
  it("searches the text, jumps to the pages that hold it and steps through them", async () => {
    render(<Viewer />);
    expect(await screen.findByText("Seite 1 von 5")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Umsatz" } });
    expect(await screen.findByText("Seite 2 von 5")).toBeTruthy();
    expect(pdf.findPages).toHaveBeenCalledWith("Umsatz");
    expect(screen.getByText("1 von 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nächster Treffer" }));
    expect(screen.getByText("Seite 4 von 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vergrößern" }));
    expect(screen.getByText("125 %")).toBeTruthy();
  });

  it("turns the page with the arrow keys from anywhere and lies on the dark surface in the full screen", async () => {
    const { container } = render(<Viewer isFullscreen />);
    await screen.findByText("Seite 1 von 5");
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    expect(screen.getByText("Seite 3 von 5")).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
    });
    expect(screen.getByText("Seite 2 von 5")).toBeTruthy();
    expect(container.querySelector(".bg-viewer-scrim")).not.toBeNull();
  });

  it("names an encrypted PDF instead of asking for its password", async () => {
    pdf.open.mockRejectedValue(passwordError());
    render(<Viewer />);
    expect((await screen.findByRole("alert")).textContent).toContain("verschlüsselt");
    expect(isPdfPasswordError(new Error("x"))).toBe(false);
  });
});

describe("the facts read with the preview of a PDF (PAGE-385)", () => {
  it("tells the page count and the title, or that the PDF is encrypted", async () => {
    pdf.openBytes.mockResolvedValue(preview());
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const facts = vi.fn();
    await createThumbnail(new Blob(["%PDF"]), "application/pdf", facts);
    expect(facts).toHaveBeenCalledWith({ pageCount: 5, title: "Quartalsbericht" });
    pdf.openBytes.mockRejectedValue(passwordError());
    const locked = vi.fn();
    expect(await createThumbnail(new Blob(["%PDF"]), "application/pdf", locked)).toBeNull();
    await waitFor(() => expect(locked).toHaveBeenCalledWith({ isEncrypted: true }));
    getContext.mockRestore();
  });
});
