import { expect, it, vi } from "vitest";

import { ConversationError } from "@/backend/error/ConversationError";
import {
  ConversationLinks,
  conversationLinkImageUrl,
  findLinkUrls,
  readLinkLine,
} from "@/backend/service/conversation/content/ConversationLinks";

import { EMPLOYEE as PERSON } from "../../../../app/server-lib/request-fixtures";

import type { ConversationLinksDependencies } from "@/backend/service/conversation/content/ConversationLinks";

function setup(): {
  readonly service: ConversationLinks;
  readonly dependencies: ConversationLinksDependencies;
} {
  const dependencies = {
    previews: {
      find: vi.fn().mockResolvedValue(new Map()),
      save: vi.fn().mockResolvedValue(null),
      removeBefore: vi.fn().mockResolvedValue(["old"]),
      storageNames: vi.fn().mockResolvedValue(["kept"]),
    },
    domains: {
      global: vi.fn().mockResolvedValue(["global.example"]),
      forConversations: vi
        .fn()
        .mockImplementation((ids: string[]) =>
          Promise.resolve(new Map(ids.map((id) => [id, ["member.example"]]))),
        ),
      add: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      addGlobal: vi.fn().mockResolvedValue(undefined),
      removeGlobal: vi.fn().mockResolvedValue(undefined),
    },
    conversations: { findForMember: vi.fn().mockResolvedValue({ id: "c1" }) },
    fetcher: { fetch: vi.fn().mockResolvedValue(null) },
    files: { remove: vi.fn(), sweep: vi.fn() },
    publisher: { publish: vi.fn() },
    ownHosts: () => ["pages.example"],
    now: () => new Date("2026-11-14T00:00:00.000Z"),
  } as unknown as ConversationLinksDependencies;
  return { service: new ConversationLinks(dependencies), dependencies };
}

it("recognizes standalone URLs, excludes code and limits distinct links", () => {
  expect(readLinkLine(" <HTTPS://Example.com/a> ")).toBe(
    "https://example.com/a",
  );
  for (const line of [
    "text https://example.com",
    "ftp://example.com",
    "https://user:pass@example.com",
    "https://%",
    `https://x.test/${"a".repeat(2000)}`,
  ]) {
    expect(readLinkLine(line)).toBeNull();
  }
  const lines = [
    "https://a.test",
    "https://a.test/",
    "```",
    "https://hidden.test",
    "```",
    ...Array.from({ length: 12 }, (_, index) => `https://x${index}.test`),
  ];
  expect(findLinkUrls(lines.join("\n"))).toEqual([
    "https://a.test/",
    ...Array.from({ length: 9 }, (_, index) => `https://x${index}.test/`),
  ]);
  expect(conversationLinkImageUrl("https://a.test/?x=1")).toBe(
    "/chat/link-image?url=https%3A%2F%2Fa.test%2F%3Fx%3D1",
  );
});

it("uses membership and global releases to decide embedding", async () => {
  const { service, dependencies } = setup();
  await expect(
    service.isEmbeddable(PERSON, { url: "invalid", conversationId: null }),
  ).resolves.toBe(false);
  await expect(
    service.isEmbeddable(PERSON, {
      url: "http://localhost:3001",
      conversationId: null,
    }),
  ).resolves.toBe(true);
  await expect(
    service.isEmbeddable(PERSON, {
      url: "https://member.example",
      conversationId: "c1",
    }),
  ).resolves.toBe(true);
  await expect(
    service.isEmbeddable(PERSON, {
      url: "https://member.example",
      conversationId: "bad id",
    }),
  ).resolves.toBe(false);
  await expect(
    service.isEmbeddable(PERSON, {
      url: "https://global.example",
      conversationId: null,
    }),
  ).resolves.toBe(true);
  expect(dependencies.conversations.findForMember).toHaveBeenCalledTimes(1);
});

it("validates releases, normalizes domains and publishes conversation changes", async () => {
  const { service, dependencies } = setup();
  await service.setReleased(PERSON, {
    conversationId: "c1",
    domain: " Example.COM ",
    isReleased: true,
  });
  await service.setReleased(PERSON, {
    conversationId: "c1",
    domain: "example.com",
    isReleased: false,
  });
  await service.setGloballyReleased(PERSON, {
    domain: "Example.COM",
    isReleased: true,
  });
  await service.setGloballyReleased(PERSON, {
    domain: "example.com",
    isReleased: false,
  });
  expect(dependencies.domains.add).toHaveBeenCalledWith("c1", {
    domain: "example.com",
    addedBy: PERSON.id,
    createdAt: "2026-11-14T00:00:00.000Z",
  });
  expect(dependencies.domains.remove).toHaveBeenCalledWith("c1", "example.com");
  expect(dependencies.domains.addGlobal).toHaveBeenCalledWith({
    domain: "example.com",
    addedBy: PERSON.id,
    createdAt: "2026-11-14T00:00:00.000Z",
  });
  expect(dependencies.domains.removeGlobal).toHaveBeenCalledWith("example.com");
  expect(dependencies.publisher.publish).toHaveBeenCalledTimes(2);
  await expect(
    service.setReleased(PERSON, {
      conversationId: "bad id",
      domain: "example.com",
      isReleased: true,
    }),
  ).rejects.toEqual(new ConversationError("not_found"));
  await expect(
    service.setGloballyReleased(PERSON, {
      domain: "https://invalid",
      isReleased: true,
    }),
  ).rejects.toEqual(new ConversationError("invalid"));
});

it("stores empty fetches and sweeps expired images", async () => {
  const { service, dependencies } = setup();
  await service.refresh("https://example.com/");
  expect(dependencies.previews.save).toHaveBeenCalledWith({
    url: "https://example.com/",
    title: "",
    description: "",
    image: null,
    fetchedAt: "2026-11-14T00:00:00.000Z",
  });
  await service.sweep();
  expect(dependencies.previews.removeBefore).toHaveBeenCalledWith(
    "2026-11-13T00:00:00.000Z",
  );
  expect(dependencies.files.remove).toHaveBeenCalledWith(["old"]);
  expect(dependencies.files.sweep).toHaveBeenCalledWith(["kept"], 86400000);
  await expect(service.openImage("missing")).rejects.toEqual(
    new ConversationError("not_found"),
  );
  expect(
    await service.forMessages([
      { id: "m", conversationId: "c1", text: "no links" },
    ]),
  ).toEqual(new Map());
});

it("combines stored previews with conversation releases and avoids fetching fresh or local links", async () => {
  const { service, dependencies } = setup();
  const url = "https://member.example/path";
  vi.mocked(dependencies.previews.find).mockResolvedValue(
    new Map([
      [
        url,
        {
          url,
          title: "Title",
          description: "Description",
          image: { storageName: "image", mimeType: "image/png" },
          fetchedAt: "2026-11-13T12:00:00.000Z",
        },
      ],
    ]),
  );
  const result = await service.forMessages([
    { id: "m1", conversationId: "c1", text: `${url}\nhttp://localhost:1234` },
    { id: "m2", conversationId: "c1", text: url },
  ]);
  expect(result.get("m1")).toEqual([
    {
      url,
      domain: "member.example",
      title: "Title",
      description: "Description",
      imageUrl: conversationLinkImageUrl(url),
      embeddable: true,
    },
    {
      url: "http://localhost:1234/",
      domain: "localhost",
      title: "",
      description: "",
      imageUrl: null,
      embeddable: true,
    },
  ]);
  expect(result.get("m2")).toEqual([result.get("m1")?.[0]]);
  expect(dependencies.previews.find).toHaveBeenCalledWith([
    url,
    "http://localhost:1234/",
  ]);
  expect(dependencies.fetcher.fetch).not.toHaveBeenCalled();
});
