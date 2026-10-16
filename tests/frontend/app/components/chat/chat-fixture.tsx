import { Editor } from "@tiptap/core";
import { act, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";

import { ChatPanel } from "@/app/components/chat/chat-panel";
import { createI18n } from "@/app/lib/i18n";

import type { RenderResult } from "@testing-library/react";
import type { ChatMessage, ChatSession } from "@/definition/Chat";

/** Session IDs of the fake server; the first one opens with the panel. */
export const FIRST_SESSION = "apfel-birne-kirsche-pflaume-traube";
export const SECOND_SESSION = "eins-zwei-drei-vier-fuenf";

const TIMESTAMP = "2026-10-13T10:00:00Z";

/** A message as the fake server received it from the panel. */
export interface SentChatMessage {
  readonly requestId: string;
  readonly clientMessageId: string;
  readonly sessionId: string;
  readonly text: string;
}

/** How the fake server answers one sent message. */
export type ChatSendOutcome =
  | { readonly kind: "answer"; readonly content: string }
  | {
      readonly kind: "failure";
      readonly status: number;
      readonly code: string;
      /** Whether the server stored the question before the failure, as after a model call. */
      readonly storesQuestion: boolean;
    }
  | { readonly kind: "gateway"; readonly status: number }
  | { readonly kind: "network" };

interface HeldSend {
  readonly resolve: (outcome: ChatSendOutcome) => void;
}

function readRecord(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error("The chat request is not an object.");
  return Object.fromEntries(Object.entries(input));
}

function readText(input: unknown): string {
  if (typeof input !== "string") throw new Error("Expected a text field.");
  return input;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function session(id: string, messages: readonly ChatMessage[]): ChatSession {
  return {
    id,
    createdAt: TIMESTAMP,
    lastMessageAt: TIMESTAMP,
    preview: messages[0]?.content ?? "",
  };
}

/**
 * A fake `/chat-api` with two sessions. A sent message is answered at once
 * with `outcome`, or, after {@link hold}, waits until the test releases it.
 *
 * @remarks
 * Like the real chat service, a held send fails with the abort reason when the
 * panel cancels it, and a failure after the model call keeps the question.
 */
export class ChatServerFixture {
  public readonly sent: SentChatMessage[] = [];
  public readonly cancelled: string[] = [];
  public outcome: ChatSendOutcome = { kind: "answer", content: "Antwort" };
  private readonly sessions = new Map<string, ChatMessage[]>([
    [FIRST_SESSION, []],
    [SECOND_SESSION, []],
  ]);
  private held: HeldSend[] | null = null;
  private nextMessage = 1;

  /** Answers one request of the panel; pass it as the global `fetch`. */
  public readonly fetch = async (
    _: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const parsed: unknown = JSON.parse(readText(init.body));
    const input = readRecord(parsed);
    switch (input.intent) {
      case "open":
        return json({
          ok: true,
          overview: {
            ...this.view(FIRST_SESSION),
            attachmentLimitBytes: 16 * 1024 * 1024,
            confirmationWord: "LÖSCHEN",
          },
        });
      case "session":
        return json({ ok: true, view: this.view(readText(input.sessionId)) });
      case "sessions":
        return json({
          ok: true,
          sessions: [...this.sessions].map(([id, messages]) =>
            session(id, messages),
          ),
        });
      case "cancel":
        this.cancelled.push(readText(input.requestId));
        return json({ ok: true });
      case "send":
        return this.send(readRecord(input.message), init.signal ?? null);
      default:
        return json({ ok: false, error: "invalidInput" }, 400);
    }
  };

  /** Keeps every following send waiting until {@link release} is called. */
  public hold(): void {
    this.held = [];
  }

  /** Answers the oldest waiting send with the given outcome. */
  public release(outcome: ChatSendOutcome): void {
    const next = this.held?.shift();
    if (!next) throw new Error("No send is waiting.");
    next.resolve(outcome);
  }

  /** The stored messages of a session, as the server would return them. */
  public messages(sessionId: string): readonly ChatMessage[] {
    return this.sessions.get(sessionId) ?? [];
  }

  private view(sessionId: string): Readonly<Record<string, unknown>> {
    const messages = this.messages(sessionId);
    return { session: session(sessionId, messages), messages, pending: [] };
  }

  private store(
    sessionId: string,
    role: ChatMessage["role"],
    content: string,
  ): ChatMessage {
    const message: ChatMessage = {
      id: `message-${this.nextMessage}`,
      role,
      content,
      createdAt: TIMESTAMP,
      attachments: [],
    };
    this.nextMessage += 1;
    this.sessions.get(sessionId)?.push(message);
    return message;
  }

  private wait(signal: AbortSignal | null): Promise<ChatSendOutcome> {
    return new Promise((resolve, reject) => {
      this.held?.push({ resolve });
      signal?.addEventListener("abort", () => {
        reject(signal.reason);
      });
    });
  }

  private async send(
    message: Readonly<Record<string, unknown>>,
    signal: AbortSignal | null,
  ): Promise<Response> {
    const sent: SentChatMessage = {
      requestId: readText(message.requestId),
      clientMessageId: readText(message.clientMessageId),
      sessionId: readText(message.sessionId),
      text: readText(message.text),
    };
    this.sent.push(sent);
    const outcome = this.held ? await this.wait(signal) : this.outcome;
    return this.respond(sent, outcome);
  }

  private respond(sent: SentChatMessage, outcome: ChatSendOutcome): Response {
    switch (outcome.kind) {
      case "answer": {
        const question = this.store(sent.sessionId, "user", sent.text);
        const answer = this.store(sent.sessionId, "assistant", outcome.content);
        return json({
          ok: true,
          reply: {
            session: session(sent.sessionId, this.messages(sent.sessionId)),
            question,
            answer,
          },
        });
      }
      case "failure":
        if (outcome.storesQuestion)
          this.store(sent.sessionId, "user", sent.text);
        return json({ ok: false, error: outcome.code }, outcome.status);
      case "gateway":
        return new Response("<html>Gateway Timeout</html>", {
          status: outcome.status,
          headers: { "Content-Type": "text/html" },
        });
      case "network":
        throw new TypeError("Failed to fetch");
    }
  }
}

/**
 * Adds the layout methods that ProseMirror and the message list call and that
 * jsdom lacks.
 *
 * @returns A function that removes them again.
 */
export function installLayoutShims(): () => void {
  const emptyRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
  };
  const shims: readonly [object, string, unknown][] = [
    [Element.prototype, "scrollIntoView", () => undefined],
    [Range.prototype, "getClientRects", () => []],
    [Range.prototype, "getBoundingClientRect", () => emptyRect],
    [Document.prototype, "elementFromPoint", () => null],
  ];
  const originals = shims.map(([target, name]) =>
    Object.getOwnPropertyDescriptor(target, name),
  );
  for (const [target, name, shim] of shims)
    Object.defineProperty(target, name, { configurable: true, value: shim });
  return () => {
    shims.forEach(([target, name], index) => {
      const original = originals[index];
      if (original) Object.defineProperty(target, name, original);
      else Reflect.deleteProperty(target, name);
    });
  };
}

/** The real panel with German texts; `setOpen` closes and reopens it like the launcher. */
export interface RenderedChatPanel {
  readonly result: RenderResult;
  setOpen(isOpen: boolean): void;
}

/** Renders the real chat panel, open, as the launcher mounts it. */
export function renderChatPanel(): RenderedChatPanel {
  const i18n = createI18n("de");
  function panel(isOpen: boolean): React.ReactElement {
    return (
      <I18nextProvider i18n={i18n}>
        <ChatPanel isOpen={isOpen} onClose={() => undefined} />
      </I18nextProvider>
    );
  }
  const result = render(panel(true));
  return {
    result,
    setOpen: (isOpen) => result.rerender(panel(isOpen)),
  };
}

/** The input field of the panel; it appears once the editor has started. */
export function findChatInput(): Promise<HTMLElement> {
  return screen.findByRole("textbox", { name: "Nachricht an Pica" });
}

/** Writes into the real input field through its editor, as typing does. */
export async function typeChatMessage(text: string): Promise<void> {
  const element = await findChatInput();
  // Tiptap keeps its editor on the editable element for tests.
  const candidate: unknown = Reflect.get(element, "editor");
  if (!(candidate instanceof Editor))
    throw new Error("The chat input has no editor.");
  act(() => {
    candidate.commands.insertContent(text);
  });
}

/** Waits until the panel opened its first session, as shown in the header. */
export async function waitForSession(sessionId: string): Promise<void> {
  await screen.findByDisplayValue(sessionId);
}
