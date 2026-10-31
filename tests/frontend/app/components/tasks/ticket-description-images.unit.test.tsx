import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { TicketDescription } from "@/app/components/tasks/description/ticket-description";
import { createI18n } from "@/app/lib/i18n";

import type { TicketUploadsState } from "@/app/components/tasks/description/use-ticket-uploads";

const startEditing = vi.hoisted(() => vi.fn());
const description = vi.hoisted(() => ({ value: "" }));

vi.mock("@/app/components/tasks/description/use-ticket-description", () => ({
  useTicketDescription: () => ({
    base: description.value,
    cancel: vi.fn(),
    change: vi.fn(),
    draft: description.value,
    errorCode: "",
    isDirty: false,
    isEditing: false,
    save: vi.fn(),
    startEditing,
    status: "viewing",
    takeLatest: () => description.value,
  }),
}));

const UPLOADS: TicketUploadsState = {
  errorCode: null,
  fileName: null,
  progress: null,
  upload: vi.fn(async () => []),
};

const TICKET = {
  description: "",
  id: "ticket-1",
  key: "SYN-1",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const FIRST = "/aufgaben/attachments/11111111-first";
const SECOND = "/aufgaben/attachments/22222222-second";
const THIRD = "/aufgaben/attachments/33333333-third";

function renderDescription(source: string, canEdit = true): void {
  description.value = source;
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <MemoryRouter>
        <TicketDescription
          canEdit={canEdit}
          ticket={{ ...TICKET, description: source }}
          uploads={UPLOADS}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  startEditing.mockClear();
});

it("opens exactly the clicked image and does not start editing", () => {
  renderDescription(
    `Intro text\n\n![Erstes](${FIRST})\n\n![Zweites](${SECOND})\n\n![Drittes](${THIRD})`,
  );

  fireEvent.click(screen.getByRole("button", { name: "Open image: Zweites" }));

  const dialog = screen.getByRole("dialog", { name: "Image viewer" });
  expect(dialog.querySelector("img")?.getAttribute("src")).toBe(SECOND);
  expect(screen.getByText("2 / 3")).toBeTruthy();
  expect(startEditing).not.toHaveBeenCalled();
});

it("still starts editing on a click into the text", () => {
  renderDescription(`Intro text\n\n![Erstes](${FIRST})`);

  fireEvent.click(screen.getByText("Intro text"));

  expect(startEditing).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("never starts editing from inside the viewer, however it is clicked", () => {
  renderDescription(`![Erstes](${FIRST})\n\n![Zweites](${SECOND})`);
  fireEvent.click(screen.getByRole("button", { name: "Open image: Erstes" }));

  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  fireEvent.click(screen.getByRole("dialog"));
  fireEvent.click(screen.getByRole("img", { name: "Zweites" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });

  expect(startEditing).not.toHaveBeenCalled();
});

it("opens the viewer instead of following the link around an image", () => {
  renderDescription(`[![Verlinkt](${FIRST})](https://example.test/target)`);
  const image = screen.getByRole("img", { name: "Verlinkt" });
  const click = createEvent.click(image, { bubbles: true, cancelable: true });

  fireEvent(image, click);

  expect(click.defaultPrevented).toBe(true);
  expect(startEditing).not.toHaveBeenCalled();
  const link = screen.getByRole("link", {
    name: "Open linked target in a new tab",
  });
  expect(link.getAttribute("href")).toBe("https://example.test/target");
});

it("keeps ordinary links working and out of the viewer", () => {
  renderDescription(`[Ziel](https://example.test/target) ![Bild](${FIRST})`);

  const click = createEvent.click(screen.getByRole("link", { name: /Ziel/ }), {
    bubbles: true,
    cancelable: true,
  });
  fireEvent(screen.getByRole("link", { name: /Ziel/ }), click);

  expect(click.defaultPrevented).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(startEditing).not.toHaveBeenCalled();
});

it("pages only through the images of this description that the text shows", () => {
  renderDescription(
    `![Eins](${FIRST})\n\n![Extern](https://example.test/x.png)\n\n![Zwei](${SECOND})\n\n\`\`\`\n![Code](${THIRD})\n\`\`\``,
  );

  fireEvent.click(screen.getByRole("button", { name: "Open image: Eins" }));

  expect(screen.getByText("1 / 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  expect(screen.getByText("2 / 2")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Zwei" })).toBeTruthy();
});

it("returns the focus to the image that opened the viewer on Escape", async () => {
  renderDescription(`![Erstes](${FIRST})\n\n![Zweites](${SECOND})`);
  const opener = screen.getByRole("button", { name: "Open image: Zweites" });
  opener.focus();
  fireEvent.click(opener);

  fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });

  await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  expect(startEditing).not.toHaveBeenCalled();
});

it("opens the viewer for a person who may only read the ticket", () => {
  renderDescription(`![Erstes](${FIRST})`, false);

  fireEvent.click(screen.getByRole("button", { name: "Open image: Erstes" }));

  expect(screen.getByRole("dialog", { name: "Image viewer" })).toBeTruthy();
  expect(startEditing).not.toHaveBeenCalled();
});
