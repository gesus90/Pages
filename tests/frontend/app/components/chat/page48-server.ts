import type {
  ChatContextSize,
  ChatMessage,
  ChatSessionView,
} from "@/definition/Chat";

export const ACTIVE = "apfel-birne-kirsche-pflaume-traube";
export const OTHER = "eins-zwei-drei-vier-fuenf";
export const NEW = "rot-gruen-blau-gelb-weiss";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function readInput(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== "string") throw new Error("Expected JSON request");
  const parsed: unknown = JSON.parse(init.body);
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("Expected object");
  return Object.fromEntries(Object.entries(parsed));
}

/** Synthetic HTTP boundary for Pica management; no real server or model is started. */
export class ManagementServer {
  public readonly sessions = new Map<string, ChatMessage[]>([
    [ACTIVE, []],
    [OTHER, []],
  ]);
  public readonly selections: unknown[] = [];
  public failedId: string | null = null;
  public failRefresh = false;
  public compactCalls = 0;
  public context: ChatContextSize = {
    tokens: 2400,
    limit: 128_000,
    isEstimated: true,
  };
  public compactStatus: "compacted" | "notNeeded" = "compacted";
  public compactError: string | null = null;
  public isHeld = false;
  private release: (() => void) | null = null;

  /** Responds to the fetch boundary with deterministic management outcomes. */
  public readonly fetch = async (
    url: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    if (String(url) !== "/chat-api") throw new Error("Unexpected request URL");
    const input = readInput(init);
    switch (input.intent) {
      case "open":
        return this.open();
      case "new":
        this.sessions.set(NEW, []);
        return json({ ok: true, view: this.view(NEW) });
      case "sessions":
        if (this.failRefresh && this.selections.length > 0)
          return json({ ok: false, error: "network" }, 503);
        return json({
          ok: true,
          sessions: [...this.sessions.keys()].map(
            (id) => this.view(id).session,
          ),
        });
      case "session":
        return typeof input.sessionId === "string"
          ? json({ ok: true, view: this.view(input.sessionId) })
          : json({ ok: false }, 400);
      case "send":
        return this.send(input.message);
      case "delete":
        return this.remove(input);
      case "context":
        return json({ ok: true, context: this.context });
      case "compact":
        return this.compact();
      default:
        return json({ ok: false, error: "invalidInput" }, 400);
    }
  };

  /** Releases a controlled in-flight compaction. */
  public finishCompaction(): void {
    if (!this.release) throw new Error("No compaction is pending");
    this.release();
    this.release = null;
  }

  private open(): Response {
    if (this.failRefresh) return json({ ok: false, error: "network" }, 503);
    const id = this.sessions.keys().next().value ?? NEW;
    if (!this.sessions.has(id)) this.sessions.set(id, []);
    return json({
      ok: true,
      overview: {
        ...this.view(id),
        confirmationWord: "LÖSCHEN",
        attachmentLimitBytes: 1024,
      },
    });
  }

  private send(message: unknown): Response {
    if (typeof message !== "object" || message === null)
      throw new Error("Expected message");
    const sessionId: unknown = Reflect.get(message, "sessionId");
    const text: unknown = Reflect.get(message, "text");
    if (typeof sessionId !== "string" || typeof text !== "string")
      throw new Error("Expected message fields");
    const question: ChatMessage = {
      id: "question",
      role: "user",
      content: text,
      createdAt: "today",
      attachments: [],
    };
    const answer: ChatMessage = {
      id: "answer",
      role: "assistant",
      content: "Antwort",
      createdAt: "today",
      attachments: [],
    };
    this.sessions.get(sessionId)?.push(question, answer);
    this.context = { ...this.context, tokens: 2600 };
    return json({
      ok: true,
      reply: { session: this.view(sessionId).session, question, answer },
    });
  }

  private view(id: string): ChatSessionView {
    return {
      session: {
        id,
        createdAt: "2026-10-15T10:00:00Z",
        lastMessageAt: "2026-10-15T10:00:00Z",
        preview: "",
      },
      messages: this.sessions.get(id) ?? [],
      pending: [],
    };
  }

  private remove(input: Record<string, unknown>): Response {
    this.selections.push(input);
    if (!Array.isArray(input.sessionIds)) return json({ ok: false }, 400);
    const deleted: string[] = [];
    const failed: { sessionId: string; error: string }[] = [];
    for (const id of input.sessionIds) {
      if (typeof id !== "string") throw new Error("Invalid ID");
      if (id === this.failedId)
        failed.push({ sessionId: id, error: "general" });
      else {
        this.sessions.delete(id);
        deleted.push(id);
      }
    }
    return json({ ok: true, deletion: { deleted, failed, cleanupFailed: [] } });
  }

  private async compact(): Promise<Response> {
    this.compactCalls += 1;
    if (this.isHeld)
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    if (this.compactError)
      return json({ ok: false, error: this.compactError }, 400);
    this.context = { ...this.context, tokens: 400 };
    return json({
      ok: true,
      compaction: { status: this.compactStatus, context: this.context },
    });
  }
}
