import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import WikiHomeRoute, { loader } from "@/app/routes/wiki-home";

import {
  ACTOR,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

const wiki = vi.hoisted(() => ({ home: vi.fn(), forMe: vi.fn() }));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({
    wikiService: wiki,
  }),
}));
vi.mock("@/app/components/wiki/wiki-home-view", () => ({
  WikiHomeView: (props: {
    readonly feed: readonly unknown[];
    readonly home: unknown;
  }): React.ReactElement => (
    <output>{`${props.feed.length} ${JSON.stringify(props.home)}`}</output>
  ),
}));

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/wiki"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("loads the start page lists of the actor", async () => {
  wiki.home.mockResolvedValue({ recent: [] });
  wiki.forMe.mockResolvedValue([{ id: "f-1" }]);

  await expect(
    loader(routeArguments(pagesRequest("/wiki"), { user: ACTOR })),
  ).resolves.toEqual({ feed: [{ id: "f-1" }], home: { recent: [] } });
  expect(wiki.home).toHaveBeenCalledWith(ACTOR);
  expect(wiki.forMe).toHaveBeenCalledWith(ACTOR);
});

it("hands both lists to the start page", () => {
  renderRoute(WikiHomeRoute, {
    loaderData: { feed: [{ id: "f-1" }], home: { recent: [] } },
  });

  expect(screen.getByRole("status").textContent).toBe('1 {"recent":[]}');
});
