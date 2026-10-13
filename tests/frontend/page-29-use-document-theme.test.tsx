// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider, useSubmit } from "react-router";

import { useDocumentTheme } from "@/app/components/common/use-document-theme";

import type { UserTheme } from "@/definition/Settings";

function ThemeProbe({
  stored,
}: {
  readonly stored: UserTheme | undefined;
}): React.ReactElement {
  const theme = useDocumentTheme(stored);
  const submit = useSubmit();

  function save(intent: string, value: string): void {
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("theme", value);
    void submit(formData, { method: "post" });
  }

  return (
    <>
      <output aria-label="theme">{theme}</output>
      <button onClick={() => save("update-settings", "dark")} type="button">
        choose dark
      </button>
      <button onClick={() => save("update-settings", "sepia")} type="button">
        choose unknown
      </button>
      <button onClick={() => save("update-profile", "dark")} type="button">
        other form
      </button>
    </>
  );
}

/** Renders the probe with an action that stays pending until released. */
function renderProbe(stored: UserTheme | undefined): {
  readonly release: () => Promise<void>;
} {
  let resolveAction: () => void = () => {};
  const pending = new Promise<null>((resolve) => {
    resolveAction = () => resolve(null);
  });
  const router = createMemoryRouter(
    [
      {
        action: () => pending,
        element: <ThemeProbe stored={stored} />,
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);

  return {
    release: async () => {
      await act(async () => {
        resolveAction();
        await pending;
      });
    },
  };
}

describe("PAGE-29 useDocumentTheme", () => {
  it("shows the stored theme while nothing is submitted", () => {
    renderProbe("light");

    expect(screen.getByLabelText("theme")).toHaveTextContent("light");
  });

  it("follows the system where the router has no stored theme", () => {
    renderProbe(undefined);

    expect(screen.getByLabelText("theme")).toHaveTextContent("system");
  });

  it("switches at once while the choice is being saved, and settles on the stored theme", async () => {
    const user = userEvent.setup();
    const { release } = renderProbe("light");

    await user.click(screen.getByRole("button", { name: "choose dark" }));

    expect(screen.getByLabelText("theme")).toHaveTextContent("dark");

    // The saved choice comes back through the loader; a rejected one does not.
    await release();

    expect(screen.getByLabelText("theme")).toHaveTextContent("light");
  });

  it.each(["choose unknown", "other form"])(
    "ignores the submission of %s",
    async (name) => {
      const user = userEvent.setup();
      renderProbe("light");

      await user.click(screen.getByRole("button", { name }));

      expect(screen.getByLabelText("theme")).toHaveTextContent("light");
    },
  );
});

/** Stands for the root loader: the stored theme can come and go. */
function LoaderStandIn(): React.ReactElement {
  const [stored, setStored] = useState<UserTheme | undefined>("dark");

  return (
    <>
      <ThemeProbe stored={stored} />
      <button onClick={() => setStored(undefined)} type="button">
        lose loader data
      </button>
      <button onClick={() => setStored("light")} type="button">
        load light
      </button>
    </>
  );
}

describe("PAGE-29 useDocumentTheme on error pages", () => {
  function renderLoaderStandIn(): void {
    const router = createMemoryRouter(
      [{ element: <LoaderStandIn />, path: "/" }],
      { initialEntries: ["/"] },
    );

    render(<RouterProvider router={router} />);
  }

  it("keeps the theme the document had when the loader data disappears", async () => {
    const user = userEvent.setup();
    renderLoaderStandIn();

    expect(screen.getByLabelText("theme")).toHaveTextContent("dark");

    await user.click(screen.getByRole("button", { name: "lose loader data" }));

    expect(screen.getByLabelText("theme")).toHaveTextContent("dark");
  });

  it("takes a new stored theme as soon as the loader provides one", async () => {
    const user = userEvent.setup();
    renderLoaderStandIn();

    await user.click(screen.getByRole("button", { name: "lose loader data" }));
    await user.click(screen.getByRole("button", { name: "load light" }));

    expect(screen.getByLabelText("theme")).toHaveTextContent("light");

    await user.click(screen.getByRole("button", { name: "lose loader data" }));

    expect(screen.getByLabelText("theme")).toHaveTextContent("light");
  });
});
