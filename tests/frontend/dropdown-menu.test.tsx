import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Menü öffnen" }));
}

describe("DropdownMenu", () => {
  it("opens its content when the trigger is activated", async () => {
    const user = userEvent.setup();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Menü öffnen</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Abmelden</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await openMenu(user);

    expect(
      await screen.findByRole("menuitem", { name: "Abmelden" }),
    ).toBeInTheDocument();
  });

  it("invokes the selected menu item", async () => {
    const user = userEvent.setup();
    const handleSelect = vi.fn();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Menü öffnen</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={handleSelect}>Abmelden</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Abmelden" }));

    expect(handleSelect).toHaveBeenCalledTimes(1);
  });

  it("merges custom classes into content and items", async () => {
    const user = userEvent.setup();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Menü öffnen</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="custom-content">
          <DropdownMenuItem className="custom-item">Abmelden</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await openMenu(user);

    const item = await screen.findByRole("menuitem", { name: "Abmelden" });

    expect(item.className).toContain("custom-item");
  });

  it("supports keyboard interaction", async () => {
    const user = userEvent.setup();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Menü öffnen</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Abmelden</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    screen.getByRole("button", { name: "Menü öffnen" }).focus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("menuitem", { name: "Abmelden" }),
    ).toBeInTheDocument();
  });
});
