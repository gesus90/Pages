import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { loader } from "@/app/routes/chat-attachment";
import { ChatError } from "@/backend/error/ChatErrors";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const open = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ chatAttachmentService: { open } }),
}));

function load(user: User | null): Promise<Response> {
  return loader(
    routeArguments(
      new Request("http://pages.invalid/chat-api/attachments/a1"),
      user,
      { attachmentId: "a1" },
    ),
  );
}

it("refuses visitors without a session", async () => {
  expect((await thrownResponse(load(null))).status).toBe(403);
  expect(open).not.toHaveBeenCalled();
});

it("streams an own attachment as a sandboxed download", async () => {
  open.mockResolvedValue({
    attachment: {
      fileName: "Bericht ä.txt",
      size: 5,
      contentType: "text/plain",
    },
    stream: Readable.from([Buffer.from("hello")]),
  });
  const response = await load(EMPLOYEE);
  expect(open).toHaveBeenCalledWith(EMPLOYEE, "a1");
  expect(response.headers.get("Content-Disposition")).toBe(
    "attachment; filename=\"Bericht _.txt\"; filename*=UTF-8''Bericht%20%C3%A4.txt",
  );
  expect(response.headers.get("Content-Length")).toBe("5");
  expect(response.headers.get("Content-Type")).toBe("text/plain");
  expect(response.headers.get("Content-Security-Policy")).toBe(
    "default-src 'none'; sandbox",
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  expect(await response.text()).toBe("hello");
});

it("answers a foreign or missing attachment with 404", async () => {
  open.mockRejectedValue(new ChatError("attachmentMissing"));
  expect((await thrownResponse(load(EMPLOYEE))).status).toBe(404);
});

it("rethrows a failure that is not a chat error", async () => {
  const failure = new Error("disk");
  open.mockRejectedValue(failure);
  await expect(load(EMPLOYEE)).rejects.toBe(failure);
});
