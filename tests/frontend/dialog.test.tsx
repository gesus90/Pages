// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";

describe("DialogContent", () => {
  it("renders the trigger and opens the modal on activation", async () => {
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
          <p>Dialog body</p>
          <DialogClose>Close dialog</DialogClose>
        </DialogContent>
      </Dialog>,
    );

    expect(
      screen.getByRole("button", { name: "Open dialog" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dialog body")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    expect(await screen.findByText("Dialog body")).toBeInTheDocument();
    expect(screen.getByText("Dialog title")).toBeInTheDocument();
    expect(screen.getByText("Dialog description")).toBeInTheDocument();
  });

  it("merges custom classes into the modal surface", async () => {
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent className="custom-surface">
          <DialogTitle>Dialog title</DialogTitle>
          <p>Dialog body</p>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    const dialog = await screen.findByRole("dialog");

    expect(dialog.className).toContain("custom-surface");
  });

  it.each(["md", "lg"] as const)(
    "uses the shared %s width and viewport height limit",
    (size) => {
      render(
        <Dialog open>
          <DialogContent size={size}>
            <DialogTitle>Dialog title</DialogTitle>
            <DialogDescription>Description</DialogDescription>
          </DialogContent>
        </Dialog>,
      );
      expect(screen.getByRole("dialog").className).toContain(
        size === "md" ? "32rem" : "38rem",
      );
      expect(screen.getByRole("dialog").className).toContain("max-h-[90dvh]");
    },
  );

  it("closes the modal through its close control", async () => {
    const user = userEvent.setup();

    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <p>Dialog body</p>
          <DialogClose>Close dialog</DialogClose>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(await screen.findByText("Dialog body")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByText("Dialog body")).not.toBeInTheDocument();
  });
});
