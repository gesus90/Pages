import { expect, it, vi } from "vitest";

import {
  chatApi,
  chatAttachmentImageUrl,
  chatAttachmentUrl,
  ChatClientError,
  chatErrorCode,
  fetchChatAttachmentPreview,
  readChatActivity,
  readChatAttachmentPreview,
  readChatCompaction,
  readChatContext,
  readChatDeletion,
  readChatOverview,
  readChatReply,
  readChatSessions,
  readChatSessionView,
  uploadChatAttachment,
} from "@/app/lib/chat-client";

const SESSION_ID = "aa-bb-cc-dd-ee";
const SESSION = {
  id: SESSION_ID,
  createdAt: "2026-10-28 00:00:00",
  lastMessageAt: "2026-10-28 00:01:00",
  preview: "Hello",
};
const ATTACHMENT = {
  id: "file-1",
  fileName: "notes.txt",
  contentType: "text/plain",
  size: 12,
};
const QUESTION = {
  id: "question",
  role: "user",
  content: "Hello",
  createdAt: "2026-10-28 00:00:00",
  attachments: [ATTACHMENT],
};
const ANSWER = {
  id: "answer",
  role: "assistant",
  content: "Hi",
  createdAt: "2026-10-28 00:00:01",
  attachments: [{ ...ATTACHMENT, id: "file-2", origin: "assistant" }],
  isStopped: true,
};
const JOB = {
  id: "job-1",
  sessionId: SESSION_ID,
  state: "running",
  errorCode: null,
  createdAt: "2026-10-28 00:00:00",
  endedAt: null,
  usage: { context: null, tokens: null, cost: null },
};

/** Expects the chat client to refuse the work with the given code. */
function expectCode(work: () => unknown, code: string): void {
  let caught: unknown = null;
  try {
    work();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ChatClientError);
  expect(chatErrorCode(caught)).toBe(code);
}

/** Replaces the network with one answer and returns the recorder of its requests. */
function serve(
  answer: () => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => answer());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("names a failure with its code", () => {
  const error = new ChatClientError("busy");

  expect(error.name).toBe("ChatClientError");
  expect(error.message).toBe("busy");
  expect(chatErrorCode(error)).toBe("busy");
  expect(chatErrorCode(new DOMException("stop", "AbortError"))).toBe(
    "cancelled",
  );
  expect(chatErrorCode(new DOMException("bad", "SyntaxError"))).toBe("general");
  expect(chatErrorCode(new Error("x"))).toBe("general");
});

it("reads a session view with messages, pending files and its activity", () => {
  const view = readChatSessionView({
    session: SESSION,
    messages: [QUESTION, ANSWER],
    pending: [ATTACHMENT],
    activity: { job: null, steers: [], selections: [] },
  });

  expect(view).toEqual({
    session: SESSION,
    messages: [QUESTION, ANSWER],
    pending: [ATTACHMENT],
    activity: { job: null, steers: [], selections: [] },
  });
  expect(
    readChatSessionView({ session: SESSION, messages: [], pending: [] }),
  ).toEqual({ session: SESSION, messages: [], pending: [] });
});

it("reads the jobs, steers and selections of a conversation", () => {
  const steer = { messageId: "question", jobId: "job-1", status: "accepted" };
  const item = {
    attachmentId: "file-1",
    fileName: "notes.txt",
    contentType: "text/plain",
    size: 12,
    transfer: "full",
  };

  expect(
    readChatActivity({
      job: JOB,
      steers: [steer],
      selections: [{ messageId: "question", items: [item] }],
    }),
  ).toEqual({
    job: JOB,
    steers: [steer],
    selections: [{ messageId: "question", items: [item] }],
  });
});

it("refuses messages, sessions and attachments of the wrong shape", () => {
  const view = { session: SESSION, messages: [], pending: [] };

  expectCode(
    () =>
      readChatSessionView({ ...view, messages: [{ ...QUESTION, role: "x" }] }),
    "general",
  );
  expectCode(
    () => readChatSessionView({ ...view, session: { ...SESSION, id: "../x" } }),
    "general",
  );
  expectCode(
    () => readChatSessionView({ ...view, pending: [{ ...ATTACHMENT, id: 1 }] }),
    "general",
  );
  expectCode(
    () =>
      readChatSessionView({ ...view, pending: [{ ...ATTACHMENT, size: 1.5 }] }),
    "general",
  );
  expectCode(
    () =>
      readChatSessionView({ ...view, pending: [{ ...ATTACHMENT, size: "1" }] }),
    "general",
  );
  expectCode(() => readChatSessionView({ ...view, messages: null }), "general");
});

it("reads the overview with the attachment limit and the confirmation word", () => {
  const overview = { session: SESSION, messages: [], pending: [] };

  expect(
    readChatOverview({
      ...overview,
      attachmentLimitBytes: 1024,
      confirmationWord: "LÖSCHEN",
    }),
  ).toEqual({
    ...overview,
    attachmentLimitBytes: 1024,
    confirmationWord: "LÖSCHEN",
  });
  expect(
    readChatOverview({
      ...overview,
      attachmentLimitBytes: 1024,
      confirmationWord: "DELETE",
    }).confirmationWord,
  ).toBe("DELETE");
  expectCode(
    () =>
      readChatOverview({
        ...overview,
        attachmentLimitBytes: 1024,
        confirmationWord: "REMOVE",
      }),
    "general",
  );
});

it("reads a reply with and without temporary passwords", () => {
  const reply = { session: SESSION, question: QUESTION, answer: ANSWER };
  const password = {
    userId: "user-1",
    username: "ada",
    temporaryPassword: "secret-1",
  };

  expect(readChatReply(reply)).toEqual(reply);
  expect(readChatReply({ ...reply, temporaryPasswords: [password] })).toEqual({
    ...reply,
    temporaryPasswords: [password],
  });
});

it("reads the person's sessions", () => {
  expect(readChatSessions([SESSION])).toEqual([SESSION]);
  expectCode(() => readChatSessions({}), "general");
});

it("reads a context estimate with an optional limit and adapter source", () => {
  expect(
    readChatContext({ tokens: 10, limit: 100, isEstimated: true }),
  ).toEqual({ tokens: 10, limit: 100, isEstimated: true });
  expect(
    readChatContext({
      tokens: null,
      limit: null,
      isEstimated: false,
      source: "adapter",
    }),
  ).toEqual({
    tokens: null,
    limit: null,
    isEstimated: false,
    source: "adapter",
  });
});

it("refuses a negative estimate, an empty limit and a missing estimate flag", () => {
  expectCode(
    () => readChatContext({ tokens: -1, limit: null, isEstimated: true }),
    "general",
  );
  expectCode(
    () => readChatContext({ tokens: 1, limit: 0, isEstimated: true }),
    "general",
  );
  expectCode(() => readChatContext({ tokens: 1, limit: 10 }), "general");
});

it("reads deletions, cleanup failures and failed sessions", () => {
  expect(
    readChatDeletion({
      deleted: [SESSION_ID],
      cleanupFailed: ["bb-cc-dd-ee-ff"],
      failed: [{ sessionId: "cc-dd-ee-ff-gg", error: "busy" }],
    }),
  ).toEqual({
    deleted: [SESSION_ID],
    cleanupFailed: ["bb-cc-dd-ee-ff"],
    failed: [{ sessionId: "cc-dd-ee-ff-gg", error: "busy" }],
  });
});

it("reads a compaction and refuses an unknown status", () => {
  const context = { tokens: 5, limit: 100, isEstimated: true };

  expect(readChatCompaction({ status: "compacted", context })).toEqual({
    status: "compacted",
    context,
  });
  expect(readChatCompaction({ status: "notNeeded", context }).status).toBe(
    "notNeeded",
  );
  expectCode(() => readChatCompaction({ status: "done", context }), "general");
});

it("reads text, table, section and unavailable previews", () => {
  expect(
    readChatAttachmentPreview({ kind: "text", text: "a", isTruncated: false }),
  ).toEqual({ kind: "text", text: "a", isTruncated: false });
  expect(
    readChatAttachmentPreview({
      kind: "table",
      sheet: null,
      rows: [["a", "b"]],
      isTruncated: true,
    }),
  ).toEqual({
    kind: "table",
    sheet: null,
    rows: [["a", "b"]],
    isTruncated: true,
  });
  expect(
    readChatAttachmentPreview({
      kind: "table",
      sheet: "Sheet 1",
      rows: [],
      isTruncated: false,
    }),
  ).toMatchObject({ sheet: "Sheet 1" });
  const sections = ["document", "page", "slide"].map((kind, index) => ({
    kind,
    number: index + 1,
    text: kind,
  }));
  expect(
    readChatAttachmentPreview({
      kind: "sections",
      sections,
      isTruncated: false,
    }),
  ).toEqual({ kind: "sections", sections, isTruncated: false });
  expect(
    readChatAttachmentPreview({ kind: "unavailable", reason: "encrypted" }),
  ).toEqual({ kind: "unavailable", reason: "encrypted" });
});

it("refuses previews of the wrong shape", () => {
  expectCode(
    () =>
      readChatAttachmentPreview({ kind: "text", text: "a", isTruncated: 1 }),
    "general",
  );
  expectCode(
    () =>
      readChatAttachmentPreview({
        kind: "sections",
        sections: [{ kind: "chapter", number: 1, text: "a" }],
        isTruncated: false,
      }),
    "general",
  );
  expectCode(
    () => readChatAttachmentPreview({ kind: "unavailable", reason: "lost" }),
    "general",
  );
  expectCode(
    () => readChatAttachmentPreview({ kind: "image", reason: "encrypted" }),
    "general",
  );
});

it("posts an intent as JSON and returns the answer", async () => {
  const fetchMock = serve(() => Response.json({ ok: true, value: 1 }));
  const controller = new AbortController();

  await expect(
    chatApi({ intent: "overview" }, controller.signal),
  ).resolves.toEqual({ ok: true, value: 1 });
  expect(fetchMock).toHaveBeenCalledWith("/chat-api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "overview" }),
    signal: controller.signal,
  });
});

it("fails with the server's code, or a general one without a usable answer", async () => {
  serve(() => Response.json({ ok: false, error: "busy" }, { status: 409 }));
  await expect(chatApi({})).rejects.toMatchObject({ code: "busy" });

  serve(() => Response.json({ ok: false }));
  await expect(chatApi({})).rejects.toMatchObject({ code: "general" });

  serve(() => Response.json({ ok: true }, { status: 500 }));
  await expect(chatApi({})).rejects.toMatchObject({ code: "general" });

  serve(() => new Response("<html>bad gateway</html>", { status: 502 }));
  await expect(chatApi({})).rejects.toMatchObject({ code: "general" });
});

it("reports a gateway deadline without JSON as a timeout", async () => {
  for (const status of [408, 504]) {
    serve(() => new Response("timeout", { status }));
    await expect(chatApi({})).rejects.toMatchObject({ code: "timeout" });
  }
});

it("tells a cancelled request from a network failure", async () => {
  serve(() => {
    throw new TypeError("offline");
  });
  await expect(chatApi({})).rejects.toMatchObject({ code: "network" });

  const controller = new AbortController();
  controller.abort();
  await expect(chatApi({}, controller.signal)).rejects.toMatchObject({
    code: "cancelled",
  });
});

it("uploads an attachment for the next message of a session", async () => {
  const fetchMock = serve(() =>
    Response.json({ ok: true, attachment: ATTACHMENT }),
  );
  const file = new File(["hello"], "notes & more.txt", { type: "text/plain" });

  await expect(uploadChatAttachment(SESSION_ID, file)).resolves.toEqual(
    ATTACHMENT,
  );
  expect(fetchMock).toHaveBeenCalledWith(
    `/chat-api/attachments?session=${SESSION_ID}&name=notes+%26+more.txt`,
    { method: "PUT", body: file, signal: undefined },
  );
});

it("builds the addresses of an own attachment", () => {
  expect(chatAttachmentUrl("a/b")).toBe("/chat/attachments/a%2Fb");
  expect(chatAttachmentImageUrl("a/b")).toBe("/chat/attachments/a%2Fb/preview");
});

it("fetches the content preview of an attachment", async () => {
  const preview = { kind: "unavailable", reason: "tooLarge" };
  const fetchMock = serve(() => Response.json({ ok: true, preview }));

  await expect(fetchChatAttachmentPreview("file-1")).resolves.toEqual(preview);
  expect(fetchMock).toHaveBeenCalledWith("/chat/attachments/file-1/content", {
    signal: undefined,
  });
});
