import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { planSelectionCookie } from "@/app/lib/agent-plan-selection";

import { deferred } from "../drafts/draft-fixture";
import {
  mountSelection,
  selectionScope,
  selectionServer,
  storedPlan,
} from "./page159-selection-fixture";

const scrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: new EventTarget(),
  });
  window.history.replaceState(null, "", "/agents/plans");
  for (const userId of ["owner", "other"]) {
    const cookie = planSelectionCookie(selectionScope(userId));
    document.cookie = `${cookie.name}=; Path=/agents; Max-Age=0`;
  }
});

async function remembers(id: string, userId = "owner"): Promise<void> {
  await waitFor(async () => expect(await storedPlan(userId)).toBe(id));
}

async function choose(name: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name }));
  await screen.findByRole("heading", { name });
}

it("keeps a dropdown choice after leaving, returning, remounting and renaming, with explicit links taking priority", async () => {
  const server = selectionServer();
  let mounted = mountSelection(server);
  await screen.findByRole("heading", { name: "Plus Local" });
  await remembers("plan-0");
  await choose("Second");
  await remembers("plan-1");
  fireEvent.click(screen.getByRole("link", { name: "Tickets" }));
  await screen.findByRole("heading", { name: "Tickets" });
  fireEvent.click(screen.getByRole("link", { name: "Agents Plan" }));
  await screen.findByRole("heading", { name: "Second" });
  expect(mounted.router.state.location.search).toBe("?planId=plan-1");
  mounted.unmount();
  server.plans = server.plans.map((plan) =>
    plan.id === "plan-1" ? { ...plan, name: "Renamed" } : plan,
  );
  mounted = mountSelection(server, "/agents/plans");
  await screen.findByRole("heading", { name: "Renamed" });
  fireEvent.click(screen.getByRole("link", { name: "Explicit link" }));
  await screen.findByRole("heading", { name: "Linked" });
  await remembers("plan-2");
  mounted.unmount();
  mountSelection(server, "/agents/plans");
  await screen.findByRole("heading", { name: "Linked" });
});

it("keeps cookies reachable for .data requests and separate for accounts and instance ports", async () => {
  const server = selectionServer();
  const mounted = mountSelection(server);
  await remembers("plan-0");
  window.history.replaceState(null, "", "/agents/plans.data");
  expect(await storedPlan()).toBe("plan-0");
  const otherOrigin = new URL(window.location.href);
  otherOrigin.port = otherOrigin.port === "3100" ? "3101" : "3100";
  const otherInstance = planSelectionCookie({
    ...selectionScope(),
    origin: otherOrigin.origin,
  });
  expect(await otherInstance.parse(document.cookie)).toBeNull();
  server.userId = "other";
  await act(() => mounted.router.navigate("/agents/plans"));
  await screen.findByRole("heading", { name: "Empty" });
  expect(await storedPlan("other")).toBeNull();
  await choose("Second");
  await remembers("plan-1", "other");
  expect(await storedPlan()).toBe("plan-0");
  mounted.unmount();
  server.userId = "owner";
  mountSelection(server, "/agents/plans");
  await screen.findByRole("heading", { name: "Plus Local" });
});

it("discards a stale selection once and does not recreate it on the next visit", async () => {
  document.cookie =
    await planSelectionCookie(selectionScope()).serialize("deleted");
  const server = selectionServer();
  let mounted = mountSelection(server, "/agents/plans");
  await screen.findByRole("heading", { name: "Empty" });
  await waitFor(async () => expect(await storedPlan()).toBeNull());
  mounted.unmount();
  mounted = mountSelection(server, "/agents/plans");
  await screen.findByRole("heading", { name: "Empty" });
  expect(await storedPlan()).toBeNull();
  mounted.unmount();
});

it("ignores a late restoration response after a new manual selection", async () => {
  const server = selectionServer();
  const mounted = mountSelection(server);
  await remembers("plan-0");
  const pending = deferred<void>();
  server.waitForRestore = pending.promise;
  let restoration: Promise<void> | undefined;
  await act(async () => {
    restoration = mounted.router.navigate("/agents/plans");
    await Promise.resolve();
  });
  await choose("Second");
  await remembers("plan-1");
  await act(async () => {
    pending.resolve();
    await restoration;
  });
  expect(screen.getByRole("heading").textContent).toBe("Second");
  expect(await storedPlan()).toBe("plan-1");
});

it("ignores a late restoration from the previous account", async () => {
  const server = selectionServer();
  const mounted = mountSelection(server);
  await remembers("plan-0");
  const pending = deferred<void>();
  server.waitForRestore = pending.promise;
  let restoration: Promise<void> | undefined;
  await act(async () => {
    restoration = mounted.router.navigate("/agents/plans");
  });
  server.userId = "other";
  await act(() => mounted.router.navigate("/agents/plans?planId=plan-1"));
  await remembers("plan-1", "other");
  await act(async () => {
    pending.resolve();
    await restoration;
  });
  expect(screen.getByRole("heading").textContent).toBe("Second");
  expect(await storedPlan()).toBe("plan-0");
  expect(await storedPlan("other")).toBe("plan-1");
});

it("preserves unsaved changes and the existing cancel/discard navigation decision", async () => {
  const server = selectionServer();
  mountSelection(server);
  await screen.findByRole("heading", { name: "Plus Local" });
  await remembers("plan-0");
  fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), {
    target: { value: "Unsaved" },
  });
  fireEvent.click(screen.getByRole("link", { name: "Explicit link" }));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("textbox").getAttribute("value")).toBe("Unsaved");
  expect(await storedPlan()).toBe("plan-0");
  fireEvent.click(screen.getByRole("link", { name: "Explicit link" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  await screen.findByRole("heading", { name: "Linked" });
  await remembers("plan-2");
});
