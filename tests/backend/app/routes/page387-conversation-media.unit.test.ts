import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { ConversationError } from "@/backend/error/ConversationError";

import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  conversationMediaOverview: {
    overview: vi.fn(),
    archive: vi.fn(),
  },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: () => Promise.resolve(services),
}));

const member: User = {
  id: "person-1",
  username: "person-1",
  displayName: "Person 1",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

function args(
  url: string,
  actor: User | null = member,
): {
  context: { get: () => User | null };
  params: { id: string };
  request: Request;
} {
  return {
    context: { get: () => actor },
    params: { id: "group-1" },
    request: new Request(url),
  };
}

async function refusal(run: () => Promise<Response>): Promise<number> {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof Response) return error.status;
    throw error;
  }
  return 200;
}

describe("the routes of Medien & Dateien (PAGE-387)", () => {
  it("lists the overview of a chat for a member and answers 404 to anybody else", async () => {
    const { loader } = await import("@/app/routes/conversation-media");
    services.conversationMediaOverview.overview.mockResolvedValueOnce({
      conversationId: "group-1",
      files: [],
      links: [],
      senders: [],
    });
    const response = await loader(
      args("https://pages.example/chat/media/group-1") as never,
    );
    expect(await response.json()).toEqual({
      overview: {
        conversationId: "group-1",
        files: [],
        links: [],
        senders: [],
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(services.conversationMediaOverview.overview).toHaveBeenCalledWith(
      member,
      "group-1",
    );

    services.conversationMediaOverview.overview.mockRejectedValueOnce(
      new ConversationError("not_found"),
    );
    expect(
      await refusal(() =>
        loader(args("https://pages.example/chat/media/group-1") as never),
      ),
    ).toBe(404);
    expect(
      await refusal(() =>
        loader(args("https://pages.example/chat/media/group-1", null) as never),
      ),
    ).toBe(403);
  });

  it("streams the chosen files as one ZIP archive and refuses unusable choices", async () => {
    const { loader } = await import("@/app/routes/conversation-media-archive");
    services.conversationMediaOverview.archive.mockResolvedValueOnce({
      entries: [
        {
          name: "a.txt",
          sizeBytes: 3,
          open: () => Readable.from([Buffer.from("abc")]),
        },
      ],
    });
    const response = await loader(
      args(
        "https://pages.example/chat/media/group-1/files.zip?ids=a%2Cb",
      ) as never,
    );
    expect(services.conversationMediaOverview.archive).toHaveBeenCalledWith(
      member,
      { conversationId: "group-1", ids: "a,b" },
    );
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain(
      "chat-medien-group-1",
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(Number(response.headers.get("Content-Length")));
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    services.conversationMediaOverview.archive.mockRejectedValueOnce(
      new ConversationError("invalid"),
    );
    expect(
      await refusal(() =>
        loader(
          args("https://pages.example/chat/media/group-1/files.zip") as never,
        ),
      ),
    ).toBe(400);
    services.conversationMediaOverview.archive.mockRejectedValueOnce(
      new ConversationError("not_found"),
    );
    expect(
      await refusal(() =>
        loader(
          args(
            "https://pages.example/chat/media/group-1/files.zip?ids=x",
          ) as never,
        ),
      ),
    ).toBe(404);
  });
});
