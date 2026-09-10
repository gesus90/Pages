// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/app/components/ui/sheet";

describe("Sheet", () => {
  it("opens the sheet content from its trigger", async () => {
    const user = userEvent.setup();

    render(
      <Sheet>
        <SheetTrigger asChild>
          <button type="button">Navigation öffnen</button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Hauptnavigation</SheetTitle>
          <p>Navigationseinträge</p>
          <SheetClose asChild>
            <button type="button">Schließen</button>
          </SheetClose>
        </SheetContent>
      </Sheet>,
    );

    await user.click(screen.getByRole("button", { name: "Navigation öffnen" }));

    expect(await screen.findByText("Navigationseinträge")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Schließen" }),
    ).toBeInTheDocument();
  });

  it("closes the sheet from its close control", async () => {
    const user = userEvent.setup();

    render(
      <Sheet>
        <SheetTrigger asChild>
          <button type="button">Navigation öffnen</button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Hauptnavigation</SheetTitle>
          <p>Navigationseinträge</p>
          <SheetClose asChild>
            <button type="button">Schließen</button>
          </SheetClose>
        </SheetContent>
      </Sheet>,
    );

    await user.click(screen.getByRole("button", { name: "Navigation öffnen" }));
    await user.click(await screen.findByRole("button", { name: "Schließen" }));

    expect(screen.queryByText("Navigationseinträge")).not.toBeInTheDocument();
  });

  it("supports keyboard dismissal with Escape", async () => {
    const user = userEvent.setup();

    render(
      <Sheet>
        <SheetTrigger asChild>
          <button type="button">Navigation öffnen</button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Hauptnavigation</SheetTitle>
          <p>Navigationseinträge</p>
        </SheetContent>
      </Sheet>,
    );

    await user.click(screen.getByRole("button", { name: "Navigation öffnen" }));
    await screen.findByText("Navigationseinträge");
    await user.keyboard("{Escape}");

    expect(screen.queryByText("Navigationseinträge")).not.toBeInTheDocument();
  });
});
