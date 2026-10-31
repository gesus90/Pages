import { expect, it } from "vitest";

import { collectViewerImages, stepViewerIndex } from "@/app/lib/viewer-images";

function image(
  source: string,
  options: { readonly alt?: string; readonly link?: string } = {},
): HTMLImageElement {
  const element = document.createElement("img");

  element.setAttribute("src", source);
  element.setAttribute("alt", options.alt ?? "");
  element.setAttribute("data-viewer-image", "");

  if (options.link) {
    element.setAttribute("data-viewer-link", options.link);
  }

  return element;
}

function scope(...images: HTMLImageElement[]): HTMLElement {
  const root = document.createElement("div");

  root.setAttribute("data-viewer-scope", "");
  root.append(...images);

  return root;
}

it("collects the images of one text in displayed order with the opened one", () => {
  const first = image("/aufgaben/attachments/a", { alt: "Erstes" });
  const second = image("/aufgaben/attachments/b", {
    alt: "Zweites",
    link: "/aufgaben/PAGE-1",
  });
  const third = image("/aufgaben/attachments/a");
  scope(first, second, third);

  expect(collectViewerImages(second)).toEqual({
    images: [
      { alt: "Erstes", linkHref: null, src: "/aufgaben/attachments/a" },
      {
        alt: "Zweites",
        linkHref: "/aufgaben/PAGE-1",
        src: "/aufgaben/attachments/b",
      },
      { alt: "", linkHref: null, src: "/aufgaben/attachments/a" },
    ],
    index: 1,
  });
  // The same file shown twice stays two entries: the position identifies it.
  expect(collectViewerImages(third)?.index).toBe(2);
});

it("leaves out images of other texts, unmarked images and images outside a scope", () => {
  const own = image("/aufgaben/attachments/own");
  const other = image("/aufgaben/attachments/other");
  const unmarked = document.createElement("img");
  unmarked.setAttribute("src", "/aufgaben/attachments/refused");
  const root = scope(own, unmarked);
  document.body.append(root, scope(other));

  expect(collectViewerImages(own)?.images).toHaveLength(1);
  expect(collectViewerImages(other)?.images).toHaveLength(1);
  expect(collectViewerImages(image("/loose"))).toBeNull();
  expect(collectViewerImages(unmarked)).toBeNull();
});

it("steps to a neighbour and reports the ends of the list", () => {
  expect(stepViewerIndex(1, 3, -1)).toBe(0);
  expect(stepViewerIndex(1, 3, 1)).toBe(2);
  expect(stepViewerIndex(0, 3, -1)).toBeNull();
  expect(stepViewerIndex(2, 3, 1)).toBeNull();
  expect(stepViewerIndex(0, 1, 1)).toBeNull();
});
