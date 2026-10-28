// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import WikiTrashRoute, { loader } from "@/app/routes/wiki-trash";

import {
  ACTOR,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const wiki = vi.hoisted(() => ({ listTrash: vi.fn(), getSettings: vi.fn() }));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({
    wikiService: wiki,
  }),
}));
vi.mock("@/app/components/wiki/wiki-trash-view", () => ({
  WikiTrashView: (props: {
    readonly entries: readonly { readonly daysLeft: number }[];
  }): React.ReactElement => (
    <output>{props.entries.map((entry) => entry.daysLeft).join(",")}</output>
  ),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  wiki.getSettings.mockResolvedValue({ trashRetentionDays: 30 });
});

afterEach(() => {
  vi.useRealTimers();
});

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/wiki/trash"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("counts the days each deleted page has left", async () => {
  wiki.listTrash.mockResolvedValue([
    { id: "recent", deletedAt: "2026-10-26 12:00:00" },
    { id: "expired", deletedAt: "2026-08-01 12:00:00" },
    { id: "unreadable", deletedAt: "not a date" },
  ]);

  const { entries } = await loader(
    routeArguments(pagesRequest("/wiki/trash"), { user: ACTOR }),
  );

  expect(entries.map((entry) => [entry.id, entry.daysLeft])).toEqual([
    ["recent", 28],
    ["expired", 0],
    ["unreadable", 30],
  ]);
  expect(wiki.listTrash).toHaveBeenCalledWith(ACTOR);
});

it("renders the trash with the loaded entries", () => {
  vi.useRealTimers();
  renderRoute(WikiTrashRoute, {
    loaderData: { entries: [{ daysLeft: 3 }, { daysLeft: 0 }] },
  });

  expect(screen.getByRole("status").textContent).toBe("3,0");
});
