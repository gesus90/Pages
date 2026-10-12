// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useChatEditor } from "@/app/components/chat/use-chat-editor";
import { useChatSend } from "@/app/components/chat/use-chat-send";
import { useChatUploads } from "@/app/components/chat/use-chat-uploads";

import type { Dispatch, SetStateAction } from "react";
import type { ChatEditor } from "@/app/components/chat/use-chat-editor";
import type { ChatSubmitOutcome } from "@/app/components/chat/use-chat-send";
import type { ChatView } from "@/app/components/chat/use-chat-uploads";

const SESSION = {
  id: "haus-baum-zelt-rabe-mond",
  createdAt: "2026-10-12T08:00:00Z",
  lastMessageAt: "2026-10-12T08:00:00Z",
  preview: "",
};
const OPEN_VIEW: ChatView = { session: SESSION, messages: [], pending: [] };
const CLOSED_VIEW: ChatView = { session: null, messages: [], pending: [] };

function refusal(): Response {
  return Response.json({ ok: false, error: "general" }, { status: 500 });
}

describe("A11.10 g1: sending without a session or twice", () => {
  it("returns the text when there is no session to send it to", async () => {
    const fetchMock = vi.fn(async () => refusal());
    vi.stubGlobal("fetch", fetchMock);
    const setError = vi.fn<(code: string) => void>();
    const { result } = renderHook(() =>
      useChatSend({
        isOpen: true,
        view: CLOSED_VIEW,
        setView: vi.fn<Dispatch<SetStateAction<ChatView>>>(),
        setError,
      }),
    );

    let outcome: ChatSubmitOutcome = "clear";
    await act(async () => {
      outcome = await result.current.send("Hallo");
    });

    expect(outcome).toBe("restore");
    expect(result.current.sending).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it("refuses a second message while the first one is still answered", async () => {
    let release: (response: Response) => void = () => undefined;
    const running = new Promise<Response>((done) => {
      release = done;
    });
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockReturnValueOnce(running)
      .mockImplementation(async () => refusal());
    vi.stubGlobal("fetch", fetchMock);
    const setError = vi.fn<(code: string) => void>();
    const { result } = renderHook(() =>
      useChatSend({
        isOpen: true,
        view: OPEN_VIEW,
        setView: vi.fn<Dispatch<SetStateAction<ChatView>>>(),
        setError,
      }),
    );

    let first: Promise<ChatSubmitOutcome> = Promise.resolve("clear");
    act(() => {
      first = result.current.send("Erste Frage");
    });
    await waitFor(() => expect(result.current.sending).not.toBeNull());
    let second: ChatSubmitOutcome = "clear";
    await act(async () => {
      second = await result.current.send("Zweite Frage");
    });

    expect(second).toBe("restore");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    let finished: ChatSubmitOutcome = "clear";
    await act(async () => {
      release(refusal());
      finished = await first;
    });
    expect(finished).toBe("restore");
    expect(setError).toHaveBeenCalledWith("general");
    expect(result.current.sending).toBeNull();
  });

  it("does nothing when a cancellation is asked for without a running answer", () => {
    const fetchMock = vi.fn(async () => refusal());
    vi.stubGlobal("fetch", fetchMock);
    const setError = vi.fn<(code: string) => void>();
    const { result } = renderHook(() =>
      useChatSend({
        isOpen: true,
        view: OPEN_VIEW,
        setView: vi.fn<Dispatch<SetStateAction<ChatView>>>(),
        setError,
      }),
    );

    act(() => {
      result.current.cancel();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });
});

describe("A11.10 g1: attaching without a session", () => {
  it("uploads nothing and reports nothing", async () => {
    const fetchMock = vi.fn(async () => refusal());
    vi.stubGlobal("fetch", fetchMock);
    const setView = vi.fn<Dispatch<SetStateAction<ChatView>>>();
    const setError = vi.fn<(code: string) => void>();
    const { result } = renderHook(() =>
      useChatUploads({
        view: CLOSED_VIEW,
        limitBytes: 1024,
        setView,
        setError,
      }),
    );

    await act(async () => {
      await result.current.attach([new File(["x"], "notes.txt")]);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(setView).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
    expect(result.current.uploading).toEqual([]);
  });
});

describe("A11.10 g1: input field before it exists", () => {
  it("ignores a replacement of the text until the editor is created", async () => {
    const renders: ChatEditor[] = [];
    const { result } = renderHook(() => {
      const input = useChatEditor({
        label: "Nachricht",
        placeholder: "Frag Pica",
        onSubmit: () => undefined,
      });
      renders.push(input);
      return input;
    });
    const [beforeCreation] = renders;

    expect(beforeCreation?.editor).toBeNull();
    act(() => {
      beforeCreation?.setMarkdown("Zu früh");
    });
    expect(result.current.markdown).toBe("");

    await waitFor(() => expect(result.current.editor).not.toBeNull());
    act(() => {
      result.current.setMarkdown("Hallo **Pica**");
    });
    expect(result.current.markdown).toBe("Hallo **Pica**");
    expect(result.current.editor?.getText()).toBe("Hallo Pica");
  });
});
