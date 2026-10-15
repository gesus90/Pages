import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { DraftProvider } from "@/app/components/common/draft-provider";
import { useWikiDraft } from "@/app/components/wiki/use-wiki-draft";
import { useTicketDescription } from "@/app/components/tasks/description/use-ticket-description";

import { wikiPage } from "./draft-fixture";

it("preserves wiki input through a lost connection and reports success only after retry", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce(
      Response.json({
        ok: true,
        saved: { ...wikiPage(), content: "Keep", revision: 2 },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useWikiDraft(wikiPage()), {
    wrapper: DraftProvider,
  });
  act(() =>
    result.current.setDraft({ ...result.current.draft, content: "Keep" }),
  );
  expect(result.current.draft.content).toBe("Keep");
  await act(async () => result.current.saveNow());
  expect(result.current.status).toBe("error");
  expect(result.current.isClean).toBe(false);
  expect(result.current.draft.content).toBe("Keep");
  await act(async () => result.current.saveNow());
  expect(result.current.status).toBe("saved");
  expect(result.current.saved.content).toBe("Keep");
});

it("retains a rejected wiki edit and both versions of a conflict until a person chooses", async () => {
  const current = { ...wikiPage(), content: "Theirs", revision: 7 };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
    )
    .mockResolvedValueOnce(
      Response.json({ ok: false, error: "conflict", current }, { status: 409 }),
    )
    .mockResolvedValueOnce(
      Response.json({
        ok: true,
        saved: { ...current, content: "Mine", revision: 8 },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const { result, rerender } = renderHook(({ page }) => useWikiDraft(page), {
    wrapper: DraftProvider,
    initialProps: { page: wikiPage() },
  });
  act(() =>
    result.current.setDraft({ ...result.current.draft, content: "Mine" }),
  );
  await act(async () => result.current.saveNow());
  expect(result.current.errorCode).toBe("forbidden");
  expect(result.current.draft.content).toBe("Mine");
  await act(async () => result.current.saveNow());
  expect(result.current.status).toBe("conflict");
  expect(result.current.conflict?.theirs.content).toBe("Theirs");
  rerender({ page: current });
  expect(result.current.draft.content).toBe("Mine");
  await act(async () => result.current.conflict?.keepMine());
  expect(result.current.status).toBe("saved");
  expect(fetcher.mock.calls[2]?.[1]?.body).toContain('"revision":7');
  expect(result.current.draft.content).toBe("Mine");
});

it("lets the person take the other wiki text and prevents a subsequent stale loader overwrite", async () => {
  const current = { ...wikiPage(), content: "Theirs", revision: 4 };
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { ok: false, error: "conflict", current },
          { status: 409 },
        ),
      ),
  );
  const { result, rerender } = renderHook(({ page }) => useWikiDraft(page), {
    wrapper: DraftProvider,
    initialProps: { page: wikiPage() },
  });
  act(() =>
    result.current.setDraft({ ...result.current.draft, content: "Mine" }),
  );
  await act(async () => result.current.saveNow());
  act(() => result.current.conflict?.takeTheirs());
  rerender({ page: wikiPage() });
  expect(result.current.draft.content).toBe("Theirs");
  expect(result.current.isClean).toBe(true);
});

it("keeps a ticket conflict across new loader data and only overwrites its explicit remote base", async () => {
  const remote = { description: "Theirs", updatedAt: "2026-10-15 10:01:00" };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        { ok: false, error: "descriptionConflict", current: remote },
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json({
        ok: true,
        saved: { description: "Mine", updatedAt: "2026-10-15 10:02:00" },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const ticket = {
    id: "ticket",
    key: "T-1",
    description: "Old",
    updatedAt: "2026-10-15 10:00:00",
  };
  const { result, rerender } = renderHook(
    ({ loaded }) => useTicketDescription(loaded),
    { wrapper: DraftProvider, initialProps: { loaded: ticket } },
  );
  act(() => result.current.change("Mine"));
  await act(async () => result.current.save());
  expect(result.current.status).toBe("conflict");
  rerender({ loaded: { ...ticket, ...remote } });
  expect(result.current.draft).toBe("Mine");
  await act(async () => result.current.save(true));
  expect(result.current.status).toBe("saved");
  expect(fetcher.mock.calls[1]?.[1]?.body).toContain('"description":"Theirs"');
});

it("keeps the editor's original base when another person saves before the first keystroke", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
    Response.json(
      {
        ok: false,
        error: "descriptionConflict",
        current: { description: "Theirs", updatedAt: "2026-10-15 10:01:00" },
      },
      { status: 409 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const original = {
    id: "ticket",
    key: "T-1",
    description: "Original",
    updatedAt: "2026-10-15 10:00:00",
  };
  const { result, rerender } = renderHook(
    ({ ticket }) => useTicketDescription(ticket),
    { wrapper: DraftProvider, initialProps: { ticket: original } },
  );
  act(() => result.current.startEditing());
  rerender({
    ticket: {
      ...original,
      description: "Theirs",
      updatedAt: "2026-10-15 10:01:00",
    },
  });
  expect(result.current.base).toBe("Original");
  act(() => result.current.change("Mine"));
  await act(async () => result.current.save());
  expect(result.current.status).toBe("conflict");
  expect(fetcher.mock.calls[0]?.[1]?.body).toContain(
    '"description":"Original"',
  );
});

it("cancels a ticket conflict by taking the confirmed remote text without another write", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
    Response.json(
      {
        ok: false,
        error: "descriptionConflict",
        current: { description: "Theirs", updatedAt: "2026-10-15 10:01:00" },
      },
      { status: 409 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(
    () =>
      useTicketDescription({
        id: "ticket",
        key: "T-1",
        description: "Old",
        updatedAt: "2026-10-15 10:00:00",
      }),
    { wrapper: DraftProvider },
  );
  act(() => result.current.change("Mine"));
  await act(async () => result.current.save());
  act(() => result.current.cancel());
  expect(result.current.isEditing).toBe(false);
  expect(result.current.draft).toBe("Theirs");
  expect(fetcher).toHaveBeenCalledOnce();
});
