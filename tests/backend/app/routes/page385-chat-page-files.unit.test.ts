import { describe, expect, it, vi } from "vitest";

import type { User } from "@/definition/User";

const services = vi.hoisted(() => ({
  conversationAttachments: {
    recordMediaFacts: vi.fn(),
    uploadThumbnail: vi.fn(),
  },
}));

vi.mock("@/app/lib/services.server", () => ({ getApplicationServices: () => Promise.resolve(services) }));
vi.mock("@/app/lib/chat-response.server", async (original) => ({
  ...(await original<typeof import("@/app/lib/chat-response.server")>()),
  requireChatRequest: vi.fn(),
}));

const member = { id: "person-1" } as User;

async function send(method: string, query: string): Promise<Response> {
  const { action } = await import("@/app/routes/chat-page-files");
  const context = { get: () => member } as unknown as Parameters<typeof action>[0]["context"];
  const request = new Request(`https://pages.example/chat-page-api/files?${query}`, {
    method,
    headers: { "Content-Type": "image/webp" },
    ...(method === "PUT" ? { body: new Uint8Array([1, 2, 3]) } : {}),
  });
  return action({ context, request } as Parameters<typeof action>[0]);
}

describe("page count and title of a PDF through the files interface (PAGE-385)", () => {
  it("passes them with a preview and on their own to the service, which checks membership", async () => {
    services.conversationAttachments.uploadThumbnail.mockResolvedValue({ id: "att-1" });
    services.conversationAttachments.recordMediaFacts.mockResolvedValue({ id: "att-1", pageCount: 7 });
    const withPreview = await send("PUT", "attachmentId=att-1&pageCount=7&title=Bericht%20Q3");
    expect(withPreview.status).toBe(200);
    expect(services.conversationAttachments.uploadThumbnail).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ attachmentId: "att-1", facts: expect.objectContaining({ pageCount: "7", title: "Bericht Q3" }) }),
      expect.anything(),
    );
    const alone = await send("PATCH", "attachmentId=att-1&pageCount=7");
    expect(await alone.json()).toEqual({ ok: true, attachment: { id: "att-1", pageCount: 7 } });
    expect(services.conversationAttachments.recordMediaFacts).toHaveBeenCalledWith(
      member,
      "att-1",
      expect.objectContaining({ pageCount: "7" }),
    );
  });
});
