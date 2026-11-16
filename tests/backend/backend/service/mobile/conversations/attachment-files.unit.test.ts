import { expect, it, vi } from "vitest";

import { PicaMobileAttachmentFiles } from "@/backend/service/mobile/conversations/PicaMobileAttachmentFiles";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { PicaMobileAttachmentFilesOptions } from "@/backend/service/mobile/conversations/PicaMobileAttachmentFiles";

function request(
  method: string,
  url: string,
  headers: IncomingMessage["headers"] = {},
): IncomingMessage {
  return partial<IncomingMessage>({ method, url, headers });
}

function response(): {
  response: ServerResponse;
  done: Promise<{ status: number; body: unknown }>;
} {
  let finish: (value: { status: number; body: unknown }) => void = () => {};
  let status = 0;
  const done = new Promise<{ status: number; body: unknown }>((resolve) => {
    finish = resolve;
  });
  return {
    response: partial<ServerResponse>({
      writeHead: (value: number) => {
        status = value;
      },
      end: (body: string) => {
        finish({ status, body: JSON.parse(body) });
      },
    }),
    done,
  };
}

it("recognizes only valid attachment paths and methods", () => {
  const handler = new PicaMobileAttachmentFiles(
    partial<PicaMobileAttachmentFilesOptions>({}),
  );
  for (const [method, path] of [
    ["GET", "/other"],
    ["GET", "/pica-mobile/chat/files/bad_id"],
    ["GET", "/pica-mobile/chat/files/id/other"],
    ["PATCH", "/pica-mobile/chat-page-api/files"],
  ]) {
    expect(
      handler.handle(request(method, path), response().response, null),
    ).toBe(false);
  }
});

it("rejects a missing bearer token before any attachment operation", async () => {
  const upload = vi.fn();
  const handler = new PicaMobileAttachmentFiles(
    partial<PicaMobileAttachmentFilesOptions>({
      resolveServices: async () => ({
        conversationAttachments: { upload },
        authService: {},
      }),
    }),
  );
  const reply = response();
  expect(
    handler.handle(
      request("POST", "/pica-mobile/chat-page-api/files"),
      reply.response,
      null,
    ),
  ).toBe(true);
  await expect(reply.done).resolves.toEqual({
    status: 401,
    body: { ok: false, error: "accessDenied" },
  });
  expect(upload).not.toHaveBeenCalled();
});

it("discards a file for a currently authorized account", async () => {
  const discard = vi.fn(async () => {});
  const handler = new PicaMobileAttachmentFiles(
    partial<PicaMobileAttachmentFilesOptions>({
      authenticator: {
        authenticate: async () => ({ ok: true, user: { id: "user" } }),
      },
      resolveServices: async () => ({
        authService: {
          getAuthenticatedUser: async () => ({
            id: "user",
            isActive: true,
            mustChangePassword: false,
          }),
        },
        conversationAttachments: { discard },
      }),
    }),
  );
  const reply = response();
  expect(
    handler.handle(
      request("DELETE", "/pica-mobile/chat-page-api/files?attachmentId=file", {
        authorization: "Bearer token",
      }),
      reply.response,
      "127.0.0.1",
    ),
  ).toBe(true);
  await expect(reply.done).resolves.toEqual({
    status: 200,
    body: { ok: true, attachment: null },
  });
  expect(discard).toHaveBeenCalledWith(
    expect.objectContaining({ id: "user" }),
    "file",
  );
});
