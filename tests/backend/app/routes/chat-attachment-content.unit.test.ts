import { expect, it, vi } from "vitest";

import { loader } from "@/app/routes/chat-attachment-content";
import { ChatError } from "@/backend/error/ChatErrors";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const preview = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ chatAttachmentService: { preview } }),
}));

function load(user: User | null): Promise<Response> {
  return loader(
    routeArguments(
      new Request("http://pages.invalid/chat-api/attachments/a1/content"),
      user,
      { attachmentId: "a1" },
    ),
  );
}

it("refuses visitors without a session", async () => {
  expect((await thrownResponse(load(null))).status).toBe(403);
  expect(preview).not.toHaveBeenCalled();
});

it("answers the preview of an own attachment as uncached sandboxed JSON", async () => {
  preview.mockResolvedValue({ kind: "text", text: "hello" });
  const response = await load(EMPLOYEE);
  expect(preview).toHaveBeenCalledWith(EMPLOYEE, "a1");
  expect(await response.json()).toEqual({
    ok: true,
    preview: { kind: "text", text: "hello" },
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Security-Policy")).toBe(
    "default-src 'none'; sandbox",
  );
});

it("answers a foreign or missing attachment with a 404 code", async () => {
  preview.mockRejectedValue(new ChatError("accessDenied"));
  const response = await load(EMPLOYEE);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    ok: false,
    error: "attachmentMissing",
  });
});

it("rethrows a failure that is not a chat error", async () => {
  const failure = new Error("disk");
  preview.mockRejectedValue(failure);
  await expect(load(EMPLOYEE)).rejects.toBe(failure);
});
