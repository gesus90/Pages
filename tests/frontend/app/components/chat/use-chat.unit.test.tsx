import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useChat } from "@/app/components/chat/use-chat";

import {
  ChatServerFixture,
  FIRST_SESSION,
  SECOND_SESSION,
} from "./chat-fixture";

import type { RenderHookResult } from "@testing-library/react";
import type { ChatController } from "@/app/components/chat/use-chat";
import type { ChatSubmitOutcome } from "@/app/components/chat/use-chat-send";

let server = new ChatServerFixture();

beforeEach(() => {
  server = new ChatServerFixture();
  vi.stubGlobal("fetch", server.fetch);
});

async function openChat(): Promise<
  RenderHookResult<ChatController, { readonly isOpen: boolean }>
> {
  const rendered = renderHook(({ isOpen }) => useChat(isOpen), {
    initialProps: { isOpen: true },
  });
  await waitFor(() => {
    expect(rendered.result.current.view.session?.id).toBe(FIRST_SESSION);
  });
  return rendered;
}

function contents(controller: ChatController): readonly string[] {
  return controller.view.messages.map(({ content }) => content);
}

it("keeps an answer in its own session when another session is opened meanwhile", async () => {
  const { result } = await openChat();
  server.hold();
  let outcome: Promise<ChatSubmitOutcome> = Promise.resolve("restore");
  act(() => {
    outcome = result.current.submit("Frage in der ersten Session");
  });

  expect(result.current.sending?.sessionId).toBe(FIRST_SESSION);

  await act(() => result.current.commands.choose(SECOND_SESSION));
  server.release({ kind: "answer", content: "Antwort der ersten Session" });

  expect(await act(() => outcome)).toBe("clear");
  expect(result.current.view.session?.id).toBe(SECOND_SESSION);
  expect(contents(result.current)).toEqual([]);
  expect(result.current.sending).toBeNull();

  await act(() => result.current.commands.choose(FIRST_SESSION));

  expect(contents(result.current)).toEqual([
    "Frage in der ersten Session",
    "Antwort der ersten Session",
  ]);
});

it("does not replace another open session when a failed answer is read again", async () => {
  const { result } = await openChat();
  server.hold();
  let outcome: Promise<ChatSubmitOutcome> = Promise.resolve("restore");
  act(() => {
    outcome = result.current.submit("Frage vor dem Wechsel");
  });
  await act(() => result.current.commands.choose(SECOND_SESSION));

  server.release({
    kind: "failure",
    status: 504,
    code: "timeout",
    storesQuestion: true,
  });

  expect(await act(() => outcome)).toBe("clear");
  expect(result.current.view.session?.id).toBe(SECOND_SESSION);
  expect(contents(result.current)).toEqual([]);
  expect(result.current.error).toBe("timeout");
  expect(server.messages(FIRST_SESSION).map(({ content }) => content)).toEqual([
    "Frage vor dem Wechsel",
  ]);
});

it("adds each reply exactly once and refuses a second send in the same moment", async () => {
  const { result } = await openChat();
  server.hold();
  let first: Promise<ChatSubmitOutcome> = Promise.resolve("restore");
  let second: Promise<ChatSubmitOutcome> = Promise.resolve("clear");
  act(() => {
    first = result.current.submit("Nur einmal");
    second = result.current.submit("Nur einmal");
  });

  expect(await act(() => second)).toBe("restore");
  expect(server.sent).toHaveLength(1);

  server.release({ kind: "answer", content: "Einmal beantwortet" });

  expect(await act(() => first)).toBe("clear");
  expect(contents(result.current)).toEqual([
    "Nur einmal",
    "Einmal beantwortet",
  ]);
});

it("keeps the running answer while the panel is closed and shows it after reopening", async () => {
  const { result, rerender } = await openChat();
  server.hold();
  let outcome: Promise<ChatSubmitOutcome> = Promise.resolve("restore");
  act(() => {
    outcome = result.current.submit("Frage beim Schließen");
  });

  rerender({ isOpen: false });

  expect(result.current.sending?.text).toBe("Frage beim Schließen");

  server.release({ kind: "answer", content: "Antwort nach dem Schließen" });
  await act(() => outcome);
  rerender({ isOpen: true });

  expect(result.current.sending).toBeNull();
  expect(contents(result.current)).toEqual([
    "Frage beim Schließen",
    "Antwort nach dem Schließen",
  ]);
});

it("gives a message sent again after a failure its client message ID and a new message a new one", async () => {
  const { result } = await openChat();
  server.outcome = { kind: "network" };
  expect(await act(() => result.current.submit("Frage"))).toBe("restore");
  server.outcome = { kind: "answer", content: "Antwort" };
  expect(await act(() => result.current.submit("Frage"))).toBe("clear");
  expect(await act(() => result.current.submit("Frage"))).toBe("clear");
  expect(await act(() => result.current.submit("Andere Frage"))).toBe("clear");

  const [failed, repeated, next, other] = server.sent;
  expect(repeated?.clientMessageId).toBe(failed?.clientMessageId);
  expect(repeated?.requestId).not.toBe(failed?.requestId);
  expect(next?.clientMessageId).not.toBe(repeated?.clientMessageId);
  expect(other?.clientMessageId).not.toBe(next?.clientMessageId);
});

it("keeps an attachment selected that finished uploading while the session was read again", async () => {
  const { result } = await openChat();
  server.outcome = { kind: "steer" };
  server.holdReads();
  let sent: Promise<ChatSubmitOutcome> = Promise.resolve("restore");
  act(() => {
    sent = result.current.submit("Zusatz während der Antwort");
  });
  await waitFor(() => {
    expect(server.waitingReads).toBe(1);
  });

  await act(() =>
    result.current.uploads.attach([new File(["Marker"], "steer.txt")]),
  );
  server.releaseRead();

  expect(await act(() => sent)).toBe("clear");
  expect(contents(result.current)).toEqual(["Zusatz während der Antwort"]);
  expect(result.current.view.pending.map(({ fileName }) => fileName)).toEqual([
    "steer.txt",
  ]);
});
