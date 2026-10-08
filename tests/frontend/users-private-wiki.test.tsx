// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { UserPrivateWikiPages } from "@/app/components/users/user-private-wiki-pages";

import { renderInWiki } from "../helpers/wiki-render";

const PAGES = [
  { id: "p1", ownerId: "o1", ownerName: "Olga" },
  { id: "p2", ownerId: "o1", ownerName: "Olga" },
];

describe("UserPrivateWikiPages", () => {
  it("renders nothing for an account without private pages", () => {
    const { container } = renderInWiki(
      <UserPrivateWikiPages ownerName="Olga" pages={[]} />,
    );

    expect(container.querySelector("button")).toBeNull();
  });

  it("lists addresses, never titles, and deletes after confirmation", async () => {
    const { layoutSubmissions } = renderInWiki(
      <UserPrivateWikiPages ownerName="Olga" pages={PAGES} />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Private wiki pages: 2" }),
    );

    const list = await screen.findByRole("dialog", {
      name: "Private wiki pages of Olga",
    });

    expect(within(list).getByText("/wiki/p1")).toBeVisible();
    expect(within(list).getByText("/wiki/p2")).toBeVisible();

    await userEvent.click(
      within(list).getAllByRole("button", { name: "Delete" })[1] as HTMLElement,
    );

    const confirmation = await screen.findByRole("dialog", {
      name: "Delete private page?",
    });

    await userEvent.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() =>
      expect(layoutSubmissions[0]).toEqual({
        intent: "delete-private-page",
        pageId: "p2",
        stay: "1",
      }),
    );
  });

  it("cancels the confirmation and closes the list", async () => {
    renderInWiki(<UserPrivateWikiPages ownerName="Olga" pages={PAGES} />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Private wiki pages: 2" }),
    );

    const list = await screen.findByRole("dialog");

    await userEvent.click(
      within(list).getAllByRole("button", { name: "Delete" })[0] as HTMLElement,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Delete private page?" }),
      ).toBeNull(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
