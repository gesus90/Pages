import { randomUUID } from "node:crypto";

import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { action as saveWiki } from "@/app/routes/wiki-draft";
import { action as saveDescription } from "@/app/routes/ticket-draft";
import { readDraftRequest } from "@/app/lib/drafts/draft-request.server";
import {
  WikiAccessDeniedError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { wikiSaveContentSchema } from "@/definition/BackgroundSave";

import type { User } from "@/definition/User";

const boundaries = vi.hoisted(() => ({
  wikiUpdate: vi.fn(),
  descriptionUpdate: vi.fn(),
  getById: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    wikiService: { update: boundaries.wikiUpdate },
    taskService: {
      updateDescription: boundaries.descriptionUpdate,
      getById: boundaries.getById,
    },
  }),
}));
const actor: User = {
  id: "owner",
  username: "owner",
  displayName: "Owner",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const content = { title: "Title", content: "text", revision: 1, icon: null };
const description = { description: "Text", updatedAt: "2026-10-15 10:00:00" };

beforeEach(() => {
  vi.resetAllMocks();
});

function request(
  input: unknown,
  options: {
    origin?: string;
    method?: string;
    authenticated?: boolean;
    streamId?: string;
    sequence?: number;
  } = {},
): { request: Request; context: RouterContextProvider } {
  const context = new RouterContextProvider();
  if (options.authenticated !== false)
    context.set(authenticatedUserContext, actor);
  return {
    request: new Request("https://pages.example/draft", {
      method: options.method ?? "POST",
      headers: {
        Origin: options.origin ?? "https://pages.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(typeof input === "object" && input !== null ? input : {}),
        streamId: options.streamId ?? randomUUID(),
        sequence: options.sequence ?? 1,
      }),
    }),
    context,
  };
}

function wikiArgs(input: unknown): Parameters<typeof saveWiki>[0] {
  return {
    ...request(input),
    params: { pageId: "page" },
    url: new URL("https://pages.example/draft"),
    pattern: "/wiki-api/drafts/:pageId",
  };
}

function ticketArgs(): Parameters<typeof saveDescription>[0] {
  return {
    ...request({
      base: description,
      draft: { ...description, description: "Edited" },
    }),
    params: { ticketId: "ticket" },
    url: new URL("https://pages.example/draft"),
    pattern: "/ticket-api/drafts/:ticketId",
  };
}

it("passes the exact revision and authenticated actor to the wiki service", async () => {
  boundaries.wikiUpdate.mockResolvedValue({ ...content, revision: 2 });
  const response = await saveWiki(wikiArgs({ base: content, draft: content }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    saved: { ...content, revision: 2 },
  });
  expect(boundaries.wikiUpdate).toHaveBeenCalledExactlyOnceWith(actor, "page", {
    title: content.title,
    content: content.content,
    icon: content.icon,
    expectedRevision: 1,
  });
});

it("preserves permission and validation failures as failures", async () => {
  for (const error of [
    new WikiAccessDeniedError(),
    new WikiValidationError("titleRequired"),
  ]) {
    boundaries.wikiUpdate.mockRejectedValueOnce(error);
    const response = await saveWiki(
      wikiArgs({ base: content, draft: content }),
    );
    expect(response.status).toBe(
      error instanceof WikiAccessDeniedError ? 403 : 400,
    );
    expect(await response.json()).toMatchObject({ ok: false });
  }
  boundaries.descriptionUpdate.mockRejectedValueOnce(
    new WorkItemAccessDeniedError(),
  );
  const response = await saveDescription(ticketArgs());
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ ok: false, error: "forbidden" });
});

it("reports the latest accessible description in a visible conflict", async () => {
  boundaries.descriptionUpdate.mockRejectedValueOnce(
    new WorkItemValidationError("descriptionConflict"),
  );
  boundaries.getById.mockResolvedValueOnce({
    description: "Theirs",
    updatedAt: "2026-10-15 10:01:00",
  });
  const response = await saveDescription(ticketArgs());
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: "descriptionConflict",
    current: { description: "Theirs" },
  });
  expect(boundaries.descriptionUpdate).toHaveBeenCalledExactlyOnceWith(
    actor,
    "ticket",
    { baseDescription: "Text", description: "Edited" },
  );
});

it("rejects unauthenticated, foreign-origin, malformed and non-POST requests", async () => {
  const valid = { base: content, draft: content };
  for (const options of [
    { authenticated: false },
    { origin: "https://foreign.example" },
    { method: "PUT" },
  ]) {
    await expect(
      readDraftRequest(request(valid, options), wikiSaveContentSchema),
    ).rejects.toBeInstanceOf(Response);
  }
  await expect(
    readDraftRequest(request({ draft: content }), wikiSaveContentSchema),
  ).rejects.toMatchObject({ status: 400 });
  const malformed = request(valid);
  await expect(
    readDraftRequest(
      {
        ...malformed,
        request: new Request("https://pages.example/draft", {
          method: "POST",
          body: "{",
        }),
      },
      wikiSaveContentSchema,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(boundaries.wikiUpdate).not.toHaveBeenCalled();
});

it("refuses a delayed older HTTP attempt after a newer no-op acknowledgement", async () => {
  const streamId = randomUUID();
  boundaries.wikiUpdate.mockResolvedValue(content);
  const args = wikiArgs({ base: content, draft: content });
  const newer = request(
    { base: content, draft: content },
    { streamId, sequence: 2 },
  );
  const older = request(
    { base: content, draft: { ...content, content: "Late" } },
    { streamId, sequence: 1 },
  );
  expect((await saveWiki({ ...args, ...newer })).status).toBe(200);
  const response = await saveWiki({ ...args, ...older });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ ok: false, error: "superseded" });
  expect(boundaries.wikiUpdate).toHaveBeenCalledOnce();
});
