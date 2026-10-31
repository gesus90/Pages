import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { ImageViewer } from "@/app/components/ui/image-viewer";
import { createI18n } from "@/app/lib/i18n";

import type { ViewerImage } from "@/app/lib/viewer-images";

const IMAGES: readonly ViewerImage[] = [
  { alt: "Erster", linkHref: null, src: "/aufgaben/attachments/one" },
  { alt: "Zweiter", linkHref: null, src: "/aufgaben/attachments/two" },
  { alt: "Dritter", linkHref: null, src: "/aufgaben/attachments/three" },
];

interface HarnessProps {
  readonly images?: readonly ViewerImage[];
  readonly initialIndex?: number;
  readonly onClose?: () => void;
}

function Harness({
  images = IMAGES,
  initialIndex = 0,
  onClose = () => undefined,
}: HarnessProps): React.ReactElement {
  const [index, setIndex] = useState(initialIndex);

  return (
    <I18nextProvider i18n={createI18n("en")}>
      <ImageViewer
        images={images}
        index={index}
        onClose={onClose}
        onIndexChange={setIndex}
      />
    </I18nextProvider>
  );
}

function shownSource(): string | null {
  return screen.getByRole("img").getAttribute("src");
}

it("shows the opened image with its position as a modal dialog", () => {
  render(<Harness initialIndex={1} />);

  const dialog = screen.getByRole("dialog", { name: "Image viewer" });
  expect(dialog).toBeTruthy();
  expect(shownSource()).toBe("/aufgaben/attachments/two");
  expect(screen.getByRole("img", { name: "Zweiter" })).toBeTruthy();
  expect(screen.getByText("2 / 3")).toBeTruthy();
  expect(dialog.contains(document.activeElement)).toBe(true);
});

it("pages with the arrows and disables the direction that has no image", () => {
  render(<Harness />);
  const previous = screen.getByRole("button", { name: "Previous image" });
  const next = screen.getByRole("button", { name: "Next image" });

  expect((previous as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(next);
  expect(shownSource()).toBe("/aufgaben/attachments/two");
  expect((previous as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(next);
  expect(shownSource()).toBe("/aufgaben/attachments/three");
  expect(screen.getByText("3 / 3")).toBeTruthy();
  expect((next as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(next);
  expect(shownSource()).toBe("/aufgaben/attachments/three");
  fireEvent.click(previous);
  expect(shownSource()).toBe("/aufgaben/attachments/two");
});

it("keeps the focus in the dialog when the used arrow turns unavailable", () => {
  render(<Harness initialIndex={1} />);
  const next = screen.getByRole("button", { name: "Next image" });

  next.focus();
  fireEvent.click(next);

  expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
    true,
  );
  expect(document.activeElement).not.toBe(next);
});

it("pages with the arrow keys and ignores them at the ends and with modifiers", () => {
  render(<Harness />);
  const dialog = screen.getByRole("dialog");

  fireEvent.keyDown(dialog, { key: "ArrowLeft" });
  expect(shownSource()).toBe("/aufgaben/attachments/one");
  fireEvent.keyDown(dialog, { key: "ArrowRight" });
  expect(shownSource()).toBe("/aufgaben/attachments/two");
  fireEvent.keyDown(dialog, { altKey: true, key: "ArrowRight" });
  expect(shownSource()).toBe("/aufgaben/attachments/two");
  fireEvent.keyDown(dialog, { key: "ArrowRight" });
  fireEvent.keyDown(dialog, { key: "ArrowRight" });
  expect(shownSource()).toBe("/aufgaben/attachments/three");
  fireEvent.keyDown(dialog, { key: "ArrowLeft" });
  expect(shownSource()).toBe("/aufgaben/attachments/two");
});

it("offers no navigation for a single image", () => {
  render(<Harness images={[IMAGES[0]]} />);

  expect(screen.queryByRole("button", { name: "Previous image" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
  expect(screen.queryByText("1 / 1")).toBeNull();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
  expect(shownSource()).toBe("/aufgaben/attachments/one");
});

it("closes by the close button and by Escape", () => {
  const close = vi.fn();
  render(<Harness onClose={close} />);

  fireEvent.click(screen.getByRole("button", { name: "Close image viewer" }));
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
  expect(close).toHaveBeenCalledTimes(2);
});

it("reports an image that cannot load and keeps the other images reachable", () => {
  render(<Harness initialIndex={1} />);

  fireEvent.error(screen.getByRole("img"));

  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("The image could not be loaded.");
  expect(alert.textContent).toContain("Zweiter");
  expect(screen.queryByRole("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  // The next image starts with its own state instead of inheriting the failure.
  expect(screen.queryByRole("alert")).toBeNull();
  expect(shownSource()).toBe("/aufgaben/attachments/three");
  expect(screen.getByText("Loading image …")).toBeTruthy();
  fireEvent.load(screen.getByRole("img"));
  expect(screen.queryByText("Loading image …")).toBeNull();
});

it("names an image without alt text by its position", () => {
  render(
    <Harness
      images={[{ alt: "", linkHref: null, src: "/aufgaben/attachments/x" }]}
    />,
  );

  expect(screen.getByRole("img", { name: "Image 1 of 1" })).toBeTruthy();
});

it("offers the target of a link around the image", () => {
  render(
    <Harness
      images={[
        {
          alt: "Mit Link",
          linkHref: "/aufgaben/PAGE-1",
          src: "/aufgaben/attachments/x",
        },
      ]}
    />,
  );

  const link = screen.getByRole("link", {
    name: "Open linked target in a new tab",
  });
  expect(link.getAttribute("href")).toBe("/aufgaben/PAGE-1");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
});
