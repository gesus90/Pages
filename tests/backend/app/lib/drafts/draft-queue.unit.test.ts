import { afterEach, expect, it, vi } from "vitest";

import { DraftQueue } from "@/app/lib/drafts/draft-queue";

import { deferred } from "../../components/drafts/draft-fixture";

import type { DraftAnswer, DraftEntry } from "@/app/lib/drafts/draft-queue";

interface Content {
  readonly text: string;
  readonly revision: number;
}

function open(queue: DraftQueue<Content>, id = "one"): DraftEntry<Content> {
  return queue.open({
    id,
    href: `/${id}`,
    label: id,
    saved: { text: "old", revision: 1 },
  });
}

function setup(): {
  queue: DraftQueue<Content>;
  save: ReturnType<
    typeof vi.fn<(entry: DraftEntry<Content>) => Promise<DraftAnswer<Content>>>
  >;
} {
  const save =
    vi.fn<(entry: DraftEntry<Content>) => Promise<DraftAnswer<Content>>>();
  const queue = new DraftQueue<Content>({
    delay: 10,
    equal: (left, right) => left.text === right.text,
    validate: () => null,
    save,
  });
  open(queue);
  return { queue, save };
}

afterEach(() => vi.useRealTimers());

it("serializes fast edits and coalesces intermediate values using the confirmed revision", async () => {
  const { queue, save } = setup();
  const first = deferred<DraftAnswer<Content>>();
  const last = deferred<DraftAnswer<Content>>();
  save.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
  queue.change("one", { text: "first", revision: 1 });
  queue.save("one");
  queue.change("one", { text: "second", revision: 1 });
  queue.save("one");
  queue.change("one", { text: "last", revision: 1 });
  expect(save).toHaveBeenCalledOnce();
  first.resolve({ ok: true, saved: { text: "first", revision: 2 } });
  await first.promise;
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[0]).toMatchObject({
    base: { text: "first", revision: 2 },
    draft: { text: "last" },
  });
  expect(open(queue).draft.text).toBe("last");
  expect(open(queue).isSaving).toBe(true);
  last.resolve({ ok: true, saved: { text: "last", revision: 3 } });
  await last.promise;
  expect(open(queue)).toMatchObject({
    base: { text: "last", revision: 3 },
    hasChanges: false,
    isSaving: false,
  });
});

it("lets separate objects finish out of order without changing each other's drafts", async () => {
  const { queue, save } = setup();
  open(queue, "two");
  const first = deferred<DraftAnswer<Content>>();
  const second = deferred<DraftAnswer<Content>>();
  save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  for (const id of ["one", "two"]) {
    queue.change(id, { text: id, revision: 1 });
    queue.save(id);
  }
  second.resolve({ ok: true, saved: { text: "two", revision: 2 } });
  await second.promise;
  expect(open(queue, "one").isSaving).toBe(true);
  first.resolve({ ok: true, saved: { text: "one", revision: 2 } });
  await first.promise;
  expect(open(queue, "one").draft.text).toBe("one");
  expect(open(queue, "two").draft.text).toBe("two");
});

it("retains input after a connection abort and retries only on request", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const { queue, save } = setup();
  save.mockRejectedValueOnce(new DOMException("Disconnected", "AbortError"));
  queue.change("one", { text: "keep me", revision: 1 });
  await vi.advanceTimersByTimeAsync(10);
  expect(open(queue)).toMatchObject({
    draft: { text: "keep me" },
    error: "connection",
    hasChanges: true,
    isSaving: false,
  });
  await vi.advanceTimersByTimeAsync(50_000);
  expect(save).toHaveBeenCalledOnce();
  save.mockResolvedValueOnce({
    ok: true,
    saved: { text: "keep me", revision: 2 },
  });
  queue.save("one");
  await Promise.resolve();
  expect(save.mock.calls[1]?.[0].base).toEqual({ text: "old", revision: 1 });
  expect(open(queue).hasChanges).toBe(false);
});

it("keeps both sides of a conflict until explicitly resolved, including further edits", async () => {
  const { queue, save } = setup();
  save.mockResolvedValueOnce({
    ok: false,
    error: "conflict",
    current: { text: "theirs", revision: 7 },
  });
  queue.change("one", { text: "mine", revision: 1 });
  queue.save("one");
  await Promise.resolve();
  expect(queue.adopt("one", { text: "loader", revision: 9 })).toBe(false);
  queue.change("one", { text: "mine again", revision: 1 });
  queue.save("one");
  expect(save).toHaveBeenCalledOnce();
  expect(open(queue).current?.text).toBe("theirs");
  save.mockResolvedValueOnce({
    ok: true,
    saved: { text: "mine again", revision: 8 },
  });
  queue.resolve("one", "mine");
  await Promise.resolve();
  expect(save.mock.calls[1]?.[0]).toMatchObject({
    base: { text: "theirs", revision: 7 },
    draft: { text: "mine again" },
  });
  expect(open(queue).hasChanges).toBe(false);
});

it("can take the remote version without a write and rejects invalid input locally", async () => {
  const save = vi.fn().mockResolvedValue({
    ok: false,
    error: "conflict",
    current: { text: "theirs", revision: 2 },
  });
  const queue = new DraftQueue<Content>({
    delay: null,
    equal: (left, right) => left.text === right.text,
    validate: (draft) => (draft.text ? null : "required"),
    save,
  });
  open(queue);
  queue.change("one", { text: "", revision: 1 });
  queue.save("one");
  expect(save).not.toHaveBeenCalled();
  expect(open(queue).error).toBe("required");
  queue.change("one", { text: "mine", revision: 1 });
  queue.save("one");
  await Promise.resolve();
  queue.resolve("one", "theirs");
  expect(open(queue)).toMatchObject({
    draft: { text: "theirs" },
    current: undefined,
    error: null,
    hasChanges: false,
  });
  expect(save).toHaveBeenCalledOnce();
});

it("does not send a previous account's delayed edits after its document scope is disposed", async () => {
  vi.useFakeTimers();
  const { queue, save } = setup();
  queue.change("one", { text: "private draft", revision: 1 });
  queue.setActive(false);
  await vi.advanceTimersByTimeAsync(20);
  queue.save("one");
  expect(save).not.toHaveBeenCalled();
});

it("keeps a reverted draft unconfirmed after response loss and retries the desired original text", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const { queue, save } = setup();
  const request = deferred<DraftAnswer<Content>>();
  save.mockReturnValueOnce(request.promise);
  queue.change("one", { text: "in flight", revision: 1 });
  queue.save("one");
  queue.change("one", { text: "old", revision: 1 });
  request.reject(new TypeError("Connection lost after commit"));
  await request.promise.catch(() => undefined);
  expect(open(queue)).toMatchObject({
    hasChanges: true,
    hasUnconfirmedWrite: true,
    error: "connection",
  });
  queue.change("one", { text: "old", revision: 1 });
  expect(open(queue).hasChanges).toBe(true);
  save.mockResolvedValueOnce({
    ok: false,
    error: "conflict",
    current: { text: "in flight", revision: 2 },
  });
  queue.save("one");
  await Promise.resolve();
  expect(save.mock.calls[1]?.[0].draft.text).toBe("old");
  expect(open(queue).current?.text).toBe("in flight");
  save.mockResolvedValueOnce({ ok: true, saved: { text: "old", revision: 3 } });
  queue.resolve("one", "mine");
  await Promise.resolve();
  expect(open(queue)).toMatchObject({
    hasChanges: false,
    hasUnconfirmedWrite: false,
    base: { text: "old", revision: 3 },
  });
});
