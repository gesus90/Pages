// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { createI18n } from "@/app/lib/i18n";

import {
  deferred,
  DescriptionFixture,
  DraftWorkspace,
  wikiPage,
  WikiEditorFixture,
} from "./draft-fixture";

import type { WikiPage } from "@/definition/Wiki";

// The backend scope has no global test setup that unmounts rendered components.
afterEach(cleanup);

afterEach(() => {
  vi.useRealTimers();
});

async function mount(second = Promise.resolve(wikiPage("two"))): Promise<void> {
  const router = createMemoryRouter(
    [
      {
        Component: DraftWorkspace,
        children: [
          {
            path: "/wiki/:pageId",
            loader: ({ params }) =>
              params.pageId === "two" ? second : wikiPage(),
            Component: WikiEditorFixture,
          },
          { path: "/dashboard", element: <h1>Dashboard ready</h1> },
          { path: "/tasks/T-1", Component: DescriptionFixture },
        ],
      },
    ],
    { initialEntries: ["/wiki/one"] },
  );
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
  await screen.findByRole("textbox", { name: "Content" });
}

it("navigates immediately during a save, shows destination loading and ignores late page/save responses", async () => {
  const second = deferred<WikiPage>();
  const save = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => save.promise),
  );
  await mount(second.promise);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Latest text" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save now" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Two" }));
  });
  expect(screen.getByRole("heading").textContent).toBe("Wiki");
  expect(screen.getByText("Loading view …")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
  });
  expect(screen.getByRole("heading").textContent).toBe("Dashboard ready");
  await act(async () => {
    second.resolve(wikiPage("two"));
    save.resolve(
      Response.json({
        ok: true,
        saved: { ...wikiPage(), content: "Latest text", revision: 2 },
      }),
    );
  });
  expect(screen.getByRole("heading").textContent).toBe("Dashboard ready");
  expect(screen.getByText("Saved")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "One" }));
  });
  expect(screen.getByRole("textbox").getAttribute("value")).toBe("Latest text");
});

it("retains debounce work after leaving, and warns until its backend confirmation", async () => {
  const save = deferred<Response>();
  const fetcher = vi.fn(() => save.promise);
  vi.stubGlobal("fetch", fetcher);
  await mount();
  vi.useFakeTimers();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Not sent yet" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
  });
  expect(screen.getByRole("heading").textContent).toBe("Dashboard ready");
  const before = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(screen.queryByText("Saved")).toBeNull();
  await act(async () => {
    save.resolve(
      Response.json({
        ok: true,
        saved: { ...wikiPage(), content: "Not sent yet", revision: 2 },
      }),
    );
  });
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});

it("keeps explicit ticket drafts across areas and retries failures with their original base", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ ok: false, error: "backend" }, { status: 503 }),
    )
    .mockResolvedValueOnce(
      Response.json({
        ok: true,
        saved: { description: "Retained", updatedAt: "2026-10-15T10:01:00Z" },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  await mount();
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Ticket" }));
  });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Retained" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
  });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Ticket" }));
  });
  expect(screen.getByRole("textbox").getAttribute("value")).toBe("Retained");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save description" }));
  });
  expect(
    screen.getByText("Saving failed. Your input is retained."),
  ).toBeTruthy();
  expect(screen.queryByText("Saved")).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  });
  expect(screen.getByText("Saved")).toBeTruthy();
  for (const call of fetcher.mock.calls) {
    expect(call[1]?.body).toContain('"base":{"description":"Old description"');
    expect(call[1]?.body).toContain('"description":"Retained"');
  }
  expect(fetcher.mock.calls[1]?.[1]?.body).toContain('"sequence":2');
});
