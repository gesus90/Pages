import { expect, it, vi } from "vitest";

import { DraftQueue } from "@/app/lib/drafts/draft-queue";

import { deferred } from "../../components/drafts/draft-fixture";

import type { DraftAnswer, DraftEntry } from "@/app/lib/drafts/draft-queue";

interface Content {
  readonly text: string;
}

type Save = (entry: DraftEntry<Content>) => Promise<DraftAnswer<Content>>;

function queueWith(
  save: Save,
  delay: number | null = null,
): DraftQueue<Content> {
  const queue = new DraftQueue<Content>({
    delay,
    equal: (left, right) => left.text === right.text,
    validate: () => null,
    save,
  });
  queue.open({ id: "one", href: "/one", label: "one", saved: { text: "old" } });
  return queue;
}

function entryOf(queue: DraftQueue<Content>): DraftEntry<Content> {
  const [entry] = queue.list();
  if (!entry) throw new Error("The draft is not open.");
  return entry;
}

it("ignores a conflict resolution when nothing conflicts", () => {
  const queue = queueWith(vi.fn<Save>());
  queue.change("one", { text: "edited" });
  const before = entryOf(queue);

  queue.resolve("one", "mine");
  queue.resolve("one", "theirs");

  expect(entryOf(queue)).toBe(before);
});

it("adopts confirmed loader data only while no local work is outstanding", async () => {
  const gate = deferred<DraftAnswer<Content>>();
  const queue = queueWith(vi.fn<Save>().mockReturnValue(gate.promise));

  expect(queue.adopt("one", { text: "server" })).toBe(true);
  expect(entryOf(queue)).toMatchObject({
    base: { text: "server" },
    draft: { text: "server" },
    error: null,
  });

  queue.change("one", { text: "edited" });
  expect(queue.adopt("one", { text: "newer" })).toBe(false);

  queue.save("one");
  expect(queue.adopt("one", { text: "newer" })).toBe(false);
  gate.resolve({ ok: true, saved: { text: "edited" } });
  await vi.waitFor(() => expect(entryOf(queue).isSaving).toBe(false));
  expect(queue.adopt("one", { text: "newer" })).toBe(true);
});

it("refuses to adopt over an unresolved conflict", async () => {
  const queue = queueWith(
    vi.fn<Save>().mockResolvedValue({
      ok: false,
      error: "conflict",
      current: { text: "theirs" },
    }),
  );
  queue.change("one", { text: "mine" });
  queue.save("one");
  await vi.waitFor(() => expect(entryOf(queue).current).toBeDefined());

  expect(queue.adopt("one", { text: "newer" })).toBe(false);
});

it("drops the answer of a save that finishes after the queue was deactivated", async () => {
  const gate = deferred<DraftAnswer<Content>>();
  const queue = queueWith(vi.fn<Save>().mockReturnValue(gate.promise));
  queue.change("one", { text: "edited" });
  queue.save("one");

  queue.setActive(false);
  gate.resolve({ ok: true, saved: { text: "edited" } });
  await gate.promise;

  expect(entryOf(queue)).toMatchObject({
    isSaving: true,
    hasUnconfirmedWrite: true,
  });
  queue.save("one");
  expect(entryOf(queue).sequence).toBe(1);
});

it("does not save again by itself when an edit arrived during a manual save", async () => {
  const gate = deferred<DraftAnswer<Content>>();
  const save = vi.fn<Save>().mockReturnValue(gate.promise);
  const queue = queueWith(save);
  queue.change("one", { text: "first" });
  queue.save("one");
  queue.change("one", { text: "second" });

  gate.resolve({ ok: true, saved: { text: "first" } });
  await vi.waitFor(() => expect(entryOf(queue).isSaving).toBe(false));

  expect(save).toHaveBeenCalledOnce();
  expect(entryOf(queue)).toMatchObject({
    hasChanges: true,
    draft: { text: "second" },
  });
});

it("refuses to edit a draft that was never opened", () => {
  const queue = queueWith(vi.fn<Save>());

  expect(() => queue.change("missing", { text: "x" })).toThrow(
    "The draft must be opened before editing.",
  );
});
