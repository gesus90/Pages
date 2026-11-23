import { afterEach, describe, expect, it, vi } from "vitest";

import { AcpTurnControl } from "@/backend/agents/acp/AcpTurnControl";

import type { ContentBlock, PromptResponse } from "@agentclientprotocol/sdk";

const text = (value: string): ContentBlock => ({ type: "text", text: value });
const done = (stopReason: PromptResponse["stopReason"]): PromptResponse => ({
  stopReason,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("add", () => {
  it("reports no turn when nothing runs", () => {
    expect(new AcpTurnControl(vi.fn()).add([text("a")])).toBe("inactive");
  });

  it("cancels the running prompt for the first input only", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const control = new AcpTurnControl(cancel);
    let release: () => void = () => undefined;
    let calls = 0;
    const running = control.drive({
      first: [text("go")],
      send: () => {
        calls += 1;
        return calls === 1
          ? new Promise((resolve) => {
              release = () => resolve(done("cancelled"));
            })
          : Promise.resolve(done("end_turn"));
      },
      settled: () => Promise.resolve(),
      signal: new AbortController().signal,
      isClosing: () => false,
      continued: () => Promise.resolve(),
    });
    expect(control.isPrompting).toBe(true);
    expect(control.add([text("a")])).toBe("injected");
    expect(control.add([text("b")])).toBe("injected");
    expect(cancel).toHaveBeenCalledOnce();
    release();
    await expect(running).resolves.toEqual(done("end_turn"));
    expect(control.isPrompting).toBe(false);
  });
});

describe("drive", () => {
  const base = {
    signal: new AbortController().signal,
    settled: () => Promise.resolve(),
    continued: () => Promise.resolve(),
    isClosing: () => false,
  };

  it("sends one prompt and ends", async () => {
    const send = vi.fn(() => Promise.resolve(done("end_turn")));
    const response = await new AcpTurnControl(vi.fn()).drive({
      ...base,
      first: [text("x")],
      send,
    });
    expect(response.stopReason).toBe("end_turn");
    expect(send).toHaveBeenCalledOnce();
  });

  it("stops continuing once the session is closing", async () => {
    const control = new AcpTurnControl(() => Promise.resolve());
    const continued = vi.fn(() => Promise.resolve());
    const send = vi.fn(() => {
      control.add([text("more")]);
      return Promise.resolve(done("end_turn"));
    });
    await control.drive({
      ...base,
      first: [text("x")],
      send,
      isClosing: () => true,
      continued,
    });
    expect(continued).not.toHaveBeenCalled();
  });

  it("continues with a waiting input", async () => {
    const control = new AcpTurnControl(() => Promise.resolve());
    const continued = vi.fn(() => Promise.resolve());
    const send = vi
      .fn<(prompt: ContentBlock[]) => Promise<PromptResponse>>()
      .mockImplementationOnce(() => {
        control.add([text("more")]);
        return Promise.resolve(done("cancelled"));
      })
      .mockResolvedValueOnce(done("end_turn"));
    await control.drive({ ...base, first: [text("x")], send, continued });
    expect(continued).toHaveBeenCalledOnce();
    expect(send.mock.calls[1][0][0]).toEqual(text("more"));
  });

  it("settles and resets after a failed prompt", async () => {
    const control = new AcpTurnControl(vi.fn());
    const settled = vi.fn(() => Promise.resolve());
    await expect(
      control.drive({
        ...base,
        first: [],
        send: () => Promise.reject(new Error("lost")),
        settled,
      }),
    ).rejects.toThrow("lost");
    expect(settled).toHaveBeenCalledOnce();
    expect(control.isPrompting).toBe(false);
  });

  it("resets when settling fails", async () => {
    const control = new AcpTurnControl(vi.fn());
    await expect(
      control.drive({
        ...base,
        first: [],
        send: () => Promise.resolve(done("end_turn")),
        settled: () => Promise.reject(new Error("settle")),
      }),
    ).rejects.toThrow("settle");
    expect(control.isPrompting).toBe(false);
  });
});

describe("interrupt and cancelWith", () => {
  function running(control: AcpTurnControl): () => void {
    let release: () => void = () => undefined;
    void control.drive({
      first: [],
      send: () =>
        new Promise((resolve) => {
          release = () => resolve(done("end_turn"));
        }),
      settled: () => Promise.resolve(),
      signal: new AbortController().signal,
      isClosing: () => false,
      continued: () => Promise.resolve(),
    });
    return () => release();
  }

  it("does nothing without a running prompt", () => {
    const cancel = vi.fn();
    const control = new AcpTurnControl(cancel);
    expect(control.interrupt()).toBe(false);
    expect(control.cancelWith("n")).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels a running prompt", () => {
    const cancel = vi.fn(() => Promise.resolve());
    const control = new AcpTurnControl(cancel);
    const release = running(control);
    expect(control.interrupt()).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    release();
  });

  it("cancels with a note that follows as the next prompt", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const control = new AcpTurnControl(cancel);
    const release = running(control);
    expect(control.cancelWith("note")).toBe(true);
    release();
    const next = await control.next("end_turn", new AbortController().signal);
    expect(next?.[0]).toEqual(text("note"));
  });
});

describe("next", () => {
  const signal = new AbortController().signal;

  it("ends the turn when nothing was interrupted", async () => {
    expect(
      await new AcpTurnControl(vi.fn()).next("end_turn", signal),
    ).toBeNull();
  });

  function interrupted(): AcpTurnControl {
    const control = new AcpTurnControl(() => Promise.resolve());
    void control.drive({
      first: [],
      send: () => new Promise(() => undefined),
      settled: () => Promise.resolve(),
      signal,
      isClosing: () => false,
      continued: () => Promise.resolve(),
    });
    control.interrupt();
    return control;
  }

  it("ends the turn when the prompt did not end as cancelled", async () => {
    expect(await interrupted().next("end_turn", signal)).toBeNull();
  });

  it("ends the turn when the node was stopped", async () => {
    const stopped = new AbortController();
    stopped.abort();
    expect(await interrupted().next("cancelled", stopped.signal)).toBeNull();
  });

  it("waits for an input of a person", async () => {
    const control = interrupted();
    const waiting = control.next("cancelled", signal);
    expect(control.isWaiting).toBe(true);
    expect(control.add([text("hi")])).toBe("injected");
    expect((await waiting)?.[0]).toEqual(text("hi"));
    expect(control.isWaiting).toBe(false);
  });

  it("ends the wait after five minutes", async () => {
    vi.useFakeTimers();
    const waiting = interrupted().next("cancelled", signal);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(await waiting).toBeNull();
  });

  it("ends the wait when the node is stopped", async () => {
    const stopped = new AbortController();
    const control = interrupted();
    const waiting = control.next("cancelled", stopped.signal);
    stopped.abort();
    expect(await waiting).toBeNull();
  });

  it("drops an input that arrives together with the stop", async () => {
    const stopped = new AbortController();
    const control = interrupted();
    const waiting = control.next("cancelled", stopped.signal);
    control.add([text("late")]);
    stopped.abort();
    expect(await waiting).toBeNull();
  });
});
