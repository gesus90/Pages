import { expect, it, vi } from "vitest";

import { WikiCoverService } from "./WikiCoverService";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiAccess, WikiViewer } from "./WikiAccess";

const actor = { id: "u" } as unknown as User;

function setup(options: {
  readonly attachment?: object | null;
  readonly canWrite?: boolean;
  readonly page?: object | null;
}): {
  readonly service: WikiCoverService;
  readonly setCover: ReturnType<typeof vi.fn>;
} {
  const setCover = vi.fn(async () => {});
  const repository = {
    attachments: { find: vi.fn(async () => options.attachment ?? null) },
    pages: {
      findVisible: vi.fn(async () =>
        options.page === undefined ? { id: "page" } : options.page,
      ),
    },
    transaction: async (work: (repository: unknown) => unknown) =>
      work(repository),
    writes: { setCover },
  } as unknown as WikiRepository;
  const access = {
    resolve: vi.fn(async () => ({
      canWrite: options.canWrite ?? true,
      scope: {},
    })),
  } as unknown as WikiAccess & { resolve(): Promise<WikiViewer> };

  return { service: new WikiCoverService(repository, access), setCover };
}

it("denies a viewer without the capability write", async () => {
  const { service } = setup({ canWrite: false });

  await expect(service.setCover(actor, "page", null)).rejects.toThrow();
});

it("removes the cover", async () => {
  const { service, setCover } = setup({});

  await expect(service.setCover(actor, "page", null)).resolves.toBeNull();
  expect(setCover).toHaveBeenCalledWith("page", null);
});

it("sets a preset cover", async () => {
  const { service, setCover } = setup({});

  await expect(
    service.setCover(actor, "page", "preset:ocean"),
  ).resolves.toEqual({ kind: "preset", preset: "ocean" });
  expect(setCover).toHaveBeenCalledWith("page", "preset:ocean");
});

it("rejects a malformed cover", async () => {
  const { service } = setup({});

  await expect(service.setCover(actor, "page", "nonsense")).rejects.toThrow();
});

it("rejects a missing page", async () => {
  const { service } = setup({ page: null });

  await expect(service.setCover(actor, "page", null)).rejects.toThrow();
});

it("sets the image of the page as cover", async () => {
  const { service, setCover } = setup({
    attachment: { contentType: "image/png", kind: "media", pageId: "page" },
  });

  await expect(
    service.setCover(actor, "page", "attachment:a1"),
  ).resolves.toEqual({ attachmentId: "a1", kind: "attachment" });
  expect(setCover).toHaveBeenCalledWith("page", "attachment:a1");
});

it.each([
  { attachment: null, name: "a missing attachment" },
  {
    attachment: { contentType: "image/png", kind: "media", pageId: "other" },
    name: "an attachment of another page",
  },
  {
    attachment: { contentType: "image/png", kind: "file", pageId: "page" },
    name: "a file that is no media",
  },
  {
    attachment: { contentType: "video/mp4", kind: "media", pageId: "page" },
    name: "a media that is no image",
  },
])("rejects $name as cover", async ({ attachment }) => {
  const { service, setCover } = setup({ attachment });

  await expect(
    service.setCover(actor, "page", "attachment:a1"),
  ).rejects.toThrow();
  expect(setCover).not.toHaveBeenCalled();
});
