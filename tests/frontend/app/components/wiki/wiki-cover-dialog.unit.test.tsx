import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { WikiCoverDialog } from "@/app/components/wiki/wiki-cover-dialog";
import { createI18n } from "@/app/lib/i18n";
import { uploadWikiFile } from "@/app/lib/wiki-upload";

import type { WikiAttachment } from "@/definition/Wiki";

const fetcher = vi.hoisted(() => ({ data: undefined, submit: vi.fn() }));
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));
vi.mock("@/app/lib/wiki-upload", () => ({
  uploadWikiFile: vi.fn(),
  WikiUploadError: class WikiUploadError extends Error {
    public code = "invalidCover";
  },
}));

const image: WikiAttachment = {
  id: "image",
  pageId: "page-1",
  fileName: "Photo.png",
  contentType: "image/png",
  kind: "media",
  size: 10,
  uploadedBy: "u",
  uploadedByName: "User",
  createdAt: "2026-01-01",
  isEmbeddable: true,
};
const i18n = createI18n("en");

beforeEach(() => {
  vi.clearAllMocks();
});

it("chooses presets or existing images and filters other attachments", () => {
  render(
    <I18nextProvider i18n={i18n}>
      <WikiCoverDialog
        pageId="page-1"
        attachments={[
          image,
          { ...image, id: "file", fileName: "notes.txt", isEmbeddable: false },
        ]}
        onClose={vi.fn()}
      />
    </I18nextProvider>,
  );
  expect(screen.queryByRole("button", { name: "notes.txt" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Photo.png" }));
  expect(fetcher.submit).toHaveBeenLastCalledWith(
    { intent: "set-cover", cover: "attachment:image" },
    { action: "/wiki/page-1", method: "post" },
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("wiki.cover.preset.sunrise") }),
  );
  expect(fetcher.submit).toHaveBeenLastCalledWith(
    { intent: "set-cover", cover: "preset:sunrise" },
    { action: "/wiki/page-1", method: "post" },
  );
});

it("uploads an image and reports rejected non-images", async () => {
  vi.mocked(uploadWikiFile)
    .mockResolvedValueOnce({ ...image, isEmbeddable: false })
    .mockResolvedValueOnce(image);
  render(
    <I18nextProvider i18n={i18n}>
      <WikiCoverDialog pageId="page-1" attachments={[]} onClose={vi.fn()} />
    </I18nextProvider>,
  );
  const input = screen.getByLabelText(i18n.t("wiki.cover.upload"), {
    selector: "input",
  });
  const file = new File(["x"], "photo.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
  expect((await screen.findByRole("alert")).textContent).toBe(
    i18n.t("wiki.errors.invalidCover"),
  );
  expect(fetcher.submit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() =>
    expect(fetcher.submit).toHaveBeenCalledWith(
      { intent: "set-cover", cover: "attachment:image" },
      { action: "/wiki/page-1", method: "post" },
    ),
  );
  expect(screen.queryByRole("alert")).toBeNull();
});
