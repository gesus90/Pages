import { describe, expect, it, vi } from "vitest";

import {
  ChatClientError,
  chatApi,
  chatErrorCode,
  readChatOverview,
  readChatReply,
  readChatSessionView,
  readChatSessions,
  uploadChatAttachment,
} from "@/app/lib/chat-client";

const SESSION = {
  id: "haus-baum-zelt-rabe-mond",
  createdAt: "2026-10-12T08:00:00Z",
  lastMessageAt: "2026-10-12T08:00:00Z",
  preview: "Hallo",
};
const ATTACHMENT = {
  id: "file-1",
  fileName: "notes.txt",
  contentType: "text/plain",
  size: 5,
};
const MESSAGE = {
  id: "m1",
  role: "user",
  content: "Hallo",
  createdAt: "2026-10-12T08:01:00Z",
  attachments: [ATTACHMENT],
};
const VIEW = { session: SESSION, messages: [MESSAGE], pending: [ATTACHMENT] };

function stubFetch(createResponse: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => createResponse()),
  );
}

function codeOf(read: () => unknown): string {
  try {
    read();
  } catch (failure: unknown) {
    return chatErrorCode(failure);
  }
  return "none";
}

describe("A11.10 g1: reading chat answers", () => {
  it("reads a session with messages and unsent attachments", () => {
    expect(readChatSessionView(VIEW)).toEqual(VIEW);
    expect(readChatSessions([SESSION])).toEqual([SESSION]);
  });

  it("rejects values of the wrong kind with the general code", () => {
    const cases: readonly unknown[] = [
      { ...VIEW, session: { ...SESSION, id: "not a session id" } },
      { ...VIEW, session: { ...SESSION, preview: 5 } },
      { ...VIEW, messages: "none" },
      { ...VIEW, messages: [{ ...MESSAGE, role: "system" }] },
      { ...VIEW, messages: [{ ...MESSAGE, content: null }] },
      { ...VIEW, pending: [{ ...ATTACHMENT, size: 1.5 }] },
      { ...VIEW, pending: [{ ...ATTACHMENT, size: "5" }] },
      { ...VIEW, pending: [{ ...ATTACHMENT, fileName: 7 }] },
    ];

    for (const value of cases) {
      expect(codeOf(() => readChatSessionView(value))).toBe("general");
    }
    expect(codeOf(() => readChatSessions({}))).toBe("general");
  });

  it("reads the overview with the confirmation word of the language", () => {
    for (const confirmationWord of ["LÖSCHEN", "DELETE"]) {
      expect(
        readChatOverview({
          ...VIEW,
          attachmentLimitBytes: 1024,
          confirmationWord,
        }),
      ).toEqual({ ...VIEW, attachmentLimitBytes: 1024, confirmationWord });
    }
    expect(
      codeOf(() =>
        readChatOverview({
          ...VIEW,
          attachmentLimitBytes: 1024,
          confirmationWord: "SUPPRIMER",
        }),
      ),
    ).toBe("general");
  });

  it("reads a reply with and without temporary passwords", () => {
    const reply = { session: SESSION, question: MESSAGE, answer: MESSAGE };
    const receipt = {
      userId: "user",
      username: "new-person",
      temporaryPassword: "secret-123",
    };

    expect(readChatReply(reply)).toEqual(reply);
    expect(readChatReply({ ...reply, temporaryPasswords: [receipt] })).toEqual({
      ...reply,
      temporaryPasswords: [receipt],
    });
    expect(
      codeOf(() => readChatReply({ ...reply, temporaryPasswords: "none" })),
    ).toBe("general");
  });
});

describe("A11.10 g1: chat requests", () => {
  it("returns the fields of an accepted request", async () => {
    stubFetch(() => Response.json({ ok: true, sessions: [] }));

    await expect(chatApi({ intent: "sessions" })).resolves.toEqual({
      ok: true,
      sessions: [],
    });
  });

  it("turns a refusal into the code of the server", async () => {
    stubFetch(() =>
      Response.json({ ok: false, error: "roleMissing" }, { status: 400 }),
    );

    await expect(chatApi({ intent: "send" })).rejects.toMatchObject({
      name: "ChatClientError",
      code: "roleMissing",
    });
  });

  it("falls back to the general code when the refusal has no usable code", async () => {
    stubFetch(() => Response.json({ ok: false, error: 500 }, { status: 500 }));
    await expect(chatApi({ intent: "open" })).rejects.toMatchObject({
      code: "general",
    });

    stubFetch(() => Response.json({ ok: true }, { status: 500 }));
    await expect(chatApi({ intent: "open" })).rejects.toMatchObject({
      code: "general",
    });
  });

  it("treats an answer that is no JSON as a general failure", async () => {
    stubFetch(() => new Response("<html>Bad Gateway</html>", { status: 502 }));

    await expect(chatApi({ intent: "open" })).rejects.toMatchObject({
      name: "ChatClientError",
      code: "general",
    });
  });

  it("uploads a file as the body of a request that names session and file", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, attachment: ATTACHMENT }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["Notiz"], "my notes.txt", { type: "text/plain" });

    await expect(uploadChatAttachment(SESSION.id, file)).resolves.toEqual(
      ATTACHMENT,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/chat-api/attachments?session=${SESSION.id}&name=my+notes.txt`,
      { method: "PUT", body: file },
    );
  });

  it("reports a refused upload with its code", async () => {
    stubFetch(() =>
      Response.json({ ok: false, error: "fileTooLarge" }, { status: 413 }),
    );

    await expect(
      uploadChatAttachment(SESSION.id, new File(["x"], "x.txt")),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
  });
});

describe("A11.10 g1: chat error codes", () => {
  it("tells the code of every kind of failure", () => {
    expect(chatErrorCode(new ChatClientError("sessionMissing"))).toBe(
      "sessionMissing",
    );
    expect(
      chatErrorCode(new DOMException("The user aborted.", "AbortError")),
    ).toBe("cancelled");
    expect(chatErrorCode(new DOMException("Late", "TimeoutError"))).toBe(
      "general",
    );
    expect(chatErrorCode(new Error("network"))).toBe("general");
    expect(chatErrorCode("text")).toBe("general");
  });
});
