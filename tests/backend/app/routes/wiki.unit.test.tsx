// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { handleWikiLayoutAction } from "@/app/lib/wiki-actions/wiki-layout-actions.server";
import WikiRoute, { action, loader } from "@/app/routes/wiki";

import {
  ACTOR,
  formPost,
  pagesRequest,
  renderRoute,
  routeArguments,
} from "./route-fixture";

// The Frontend setup registers this cleanup; the Node scope repeats it here.
afterEach(cleanup);

const wiki = vi.hoisted(() => ({
  navigation: vi.fn(),
  templates: vi.fn(),
  ownerCandidates: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({
    wikiService: wiki,
  }),
}));
vi.mock("@/app/lib/wiki-actions/wiki-layout-actions.server", () => ({
  handleWikiLayoutAction: vi.fn(),
}));
vi.mock("@/app/components/wiki/wiki-shell", () => ({
  WikiShell: (props: {
    readonly navigation: unknown;
    readonly people: readonly unknown[];
  }): React.ReactElement => (
    <output>{`${JSON.stringify(props.navigation)} ${props.people.length}`}</output>
  ),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T09:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

it("requires the user of the authentication middleware", async () => {
  await expect(
    loader(routeArguments(pagesRequest("/wiki"), { user: null })),
  ).rejects.toThrow("Authenticated middleware did not provide a user.");
});

it("loads tree, templates, people and the server's date", async () => {
  wiki.navigation.mockResolvedValue({ pages: [] });
  wiki.templates.mockResolvedValue([{ id: "t-1", title: "Note", icon: null }]);
  wiki.ownerCandidates.mockResolvedValue([{ id: "user-2" }]);

  await expect(
    loader(routeArguments(pagesRequest("/wiki"), { user: ACTOR })),
  ).resolves.toEqual({
    navigation: { pages: [] },
    people: [{ id: "user-2" }],
    templates: [{ id: "t-1", title: "Note", icon: null }],
    today: "2026-10-28",
  });
});

it("hands a structure change to the layout actions without a page", async () => {
  const outcome = new Response(null, { status: 204 });
  vi.mocked(handleWikiLayoutAction).mockResolvedValue(outcome);

  await expect(
    action(
      routeArguments(formPost("/wiki", { intent: "create" }), { user: ACTOR }),
    ),
  ).resolves.toBe(outcome);
  const [call] = vi.mocked(handleWikiLayoutAction).mock.calls;
  expect(call?.[0].actor).toBe(ACTOR);
  expect(call?.[0].pageId).toBeNull();
  expect(call?.[0].formData.get("intent")).toBe("create");
});

it("renders the wiki frame with the tree and the people", () => {
  vi.useRealTimers();
  renderRoute(WikiRoute, {
    loaderData: {
      navigation: { pages: [] },
      people: [{ id: "user-2" }],
      templates: [],
      today: "2026-10-28",
    },
  });

  expect(screen.getByRole("status").textContent).toBe('{"pages":[]} 1');
});
