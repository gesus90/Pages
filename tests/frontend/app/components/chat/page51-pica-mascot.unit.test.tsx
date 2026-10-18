import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { ChatHeader } from "@/app/components/chat/chat-header";
import { ChatLauncher } from "@/app/components/chat/chat-launcher";
import { ChatSettingsCard } from "@/app/components/settings/system/chat-settings-card";
import { createI18n } from "@/app/lib/i18n";

import {
  ChatServerFixture,
  FIRST_SESSION,
  installLayoutShims,
  renderChatPanel,
  typeChatMessage,
  waitForSession,
} from "./chat-fixture";

import picaMascotUrl from "@/assets/pica/pica_maskottchen.svg?no-inline";

import type { ChatAdministration } from "@/definition/Chat";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../../..");

/** SHA-256 of `pica_maskottchen.svg` as attached to PAGE-51. */
const TICKET_CHECKSUM =
  "6553a48c487753feab87bbdc48b5c94c365b0fceb16386a54f7ba2b698cac3f3";

let removeShims: () => void = () => undefined;
let server = new ChatServerFixture();

beforeAll(() => {
  removeShims = installLayoutShims();
});

afterAll(() => {
  removeShims();
});

beforeEach(() => {
  server = new ChatServerFixture();
  vi.stubGlobal("fetch", server.fetch);
});

function images(container: HTMLElement): HTMLImageElement[] {
  return Array.from(container.querySelectorAll("img"));
}

/** The one image in the element, which must be the whole, decorative mascot. */
function expectMascot(container: HTMLElement, size: string): void {
  const [image, ...others] = images(container);
  expect(others).toHaveLength(0);
  expect(image?.getAttribute("src")).toBe(picaMascotUrl);
  expect(image?.getAttribute("alt")).toBe("");
  const classes = Array.from(image?.classList ?? []);
  expect(classes).toContain(size);
  expect(classes).toContain("object-contain");
  expect(classes.filter((name) => name.startsWith("rounded"))).toEqual([]);
}

function renderSettingsCard(settings: ChatAdministration): HTMLElement {
  const router = createMemoryRouter(
    [
      {
        element: (
          <I18nextProvider i18n={createI18n("de")}>
            <ChatSettingsCard settings={settings} />
          </I18nextProvider>
        ),
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />).container;
}

it("ships exactly the SVG attached to PAGE-51 and no longer the former icon", () => {
  const asset = readFileSync(
    path.join(REPOSITORY_ROOT, "assets/pica/pica_maskottchen.svg"),
  );

  expect(createHash("sha256").update(asset).digest("hex")).toBe(
    TICKET_CHECKSUM,
  );
  expect(existsSync(path.join(REPOSITORY_ROOT, "assets/pica-icon.svg"))).toBe(
    false,
  );
  // A file URL of its own, not a data URL inside the page.
  expect(picaMascotUrl).toMatch(/pica_maskottchen\.svg(?:\?|$)/u);
  expect(picaMascotUrl.startsWith("data:")).toBe(false);
});

it("shows the mascot in the launcher, whose button names Pica", () => {
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <ChatLauncher />
    </I18nextProvider>,
  );
  const launcher = screen.getByRole("button", { name: "Pica öffnen" });

  expectMascot(launcher, "size-9");
  expect(launcher.getAttribute("title")).toBe("Pica öffnen");
});

it("shows the mascot beside the heading of the chat", () => {
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <ChatHeader
        context={null}
        onClose={() => undefined}
        session={{
          id: FIRST_SESSION,
          createdAt: "2026-10-16",
          lastMessageAt: "2026-10-16",
          preview: "",
        }}
      />
    </I18nextProvider>,
  );
  const header = screen.getByRole("banner");

  expect(within(header).getByRole("heading", { name: "Pica" })).toBeTruthy();
  expectMascot(header, "size-9");
});

it("marks the pending row and every answer of Pica with the mascot, never an own message", async () => {
  renderChatPanel();
  await waitForSession(FIRST_SESSION);
  server.hold();
  await typeChatMessage("Hallo Pica");
  fireEvent.click(screen.getByRole("button", { name: "Abschicken" }));

  const pending = (
    await screen.findByText("Ich blättere das für dich durch …")
  ).closest("[role='status']");
  expect(pending).toBeInstanceOf(HTMLElement);
  expectMascot(
    pending instanceof HTMLElement ? pending : document.body,
    "size-7",
  );

  server.release({ kind: "answer", content: "Hallo!" });
  const log = screen.getByRole("log", { name: "Unterhaltung mit Pica" });
  const answer = await within(log).findByRole("article", { name: "Pica" });

  expectMascot(answer, "size-7");
  const own = within(log).getByRole("article", { name: "Deine Nachricht" });
  expect(images(own)).toHaveLength(0);
});

it("shows the mascot on the settings card, which edits only a supplement", () => {
  const card = renderSettingsCard({
    attachmentLimitMegabytes: 16,
    systemInstruction: "",
    isDefaultInstruction: true,
  });

  expect(
    within(card).getByRole("heading", { name: "Chat-Assistent Pica" }),
  ).toBeTruthy();
  expectMascot(card, "size-7");
  expect(
    within(card).getByRole("textbox", {
      name: "Ergänzende Anweisung (Markdown, optional)",
    }),
  ).toBeTruthy();
  expect(card.textContent).toContain(
    "Keine Ergänzung gespeichert. Pica arbeitet nur mit den geschützten Vorgaben aus SOUL.md und AGENTS.md.",
  );
  expect(
    within(card).queryByRole("button", { name: "Ergänzung entfernen" }),
  ).toBeNull();
});
