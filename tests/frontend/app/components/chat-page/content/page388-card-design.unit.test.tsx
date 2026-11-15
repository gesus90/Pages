import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { CardPanel } from "@/app/components/chat-page/content/card-panel";
import { LinkCards } from "@/app/components/chat-page/content/link-cards";
import { DiffCard } from "@/app/components/chat-page/content/text-cards";
import { createI18n } from "@/app/lib/i18n";

import type { OpenedCard } from "@/app/components/chat-page/content/card-types";
import type { ConversationLink } from "@/definition/ConversationContent";

const content = vi.hoisted(() => ({
  expanded: false,
  canRelease: true,
  embeddable: false,
  released: [] as string[],
  setState: vi.fn(),
  setDomainReleased: vi.fn(),
  openOverlay: vi.fn(),
  openBeside: vi.fn(),
  closeBeside: vi.fn(),
  copy: vi.fn(),
}));

vi.mock("@/app/components/chat-page/content/chat-content-context", () => ({
  useChatContent: () => ({
    conversationId: "conversation",
    stateOf: () => (content.expanded ? "expanded" : "collapsed"),
    beside: null,
    setState: content.setState,
    openBeside: content.openBeside,
    closeBeside: content.closeBeside,
    openOverlay: content.openOverlay,
    canRelease: content.canRelease,
    releasedDomains: content.released,
    setDomainReleased: content.setDomainReleased,
    isEmbeddable: () => content.embeddable,
  }),
}));
vi.mock("@/app/components/chat-page/content/use-card-text", () => ({
  useCardText: (text: { source: string | null }) => ({
    source: text.source,
    isFailed: false,
  }),
  copyText: content.copy,
  saveTextFile: vi.fn(),
}));

const LINK: ConversationLink = {
  url: "https://example.org/path",
  domain: "example.org",
  title: "Example page",
  description: "What the page is about",
  imageUrl: "/preview.png",
  embeddable: false,
};

const DIFF = [
  "--- a/app.ts",
  "+++ b/app.ts",
  "@@ -1,2 +1,2 @@",
  "-old line",
  "+new line",
  "+another line",
].join("\n");

function wrap(element: React.ReactNode): React.ReactElement {
  return <I18nextProvider i18n={createI18n("en")}>{element}</I18nextProvider>;
}

/** The accessible names of the buttons and links of a head, in their order. */
function actionNames(head: HTMLElement): string[] {
  return [...head.querySelectorAll("a, button")].map(
    (element) =>
      element.getAttribute("aria-label") ??
      element.getAttribute("title") ??
      element.textContent ??
      "",
  );
}

function head(region: HTMLElement): HTMLElement {
  const found = region.querySelector<HTMLElement>("[data-card-head]");
  if (!found) throw new Error("no card head");
  return found;
}

beforeEach(() => {
  content.expanded = false;
  content.canRelease = true;
  content.embeddable = false;
  content.released = [];
  vi.clearAllMocks();
});

it("gives a link card the shared head: link icon, title, domain and the main action first", () => {
  render(wrap(<LinkCards links={[LINK]} messageId="m" origin={{ senderName: "Ada" }} />));

  const card = screen.getByRole("region", { name: "Example page" });
  const cardHead = head(card);
  expect(cardHead.querySelector(".bg-primary-subtle svg")).toBeTruthy();
  expect(within(cardHead).getByText("Example page").className).toContain("font-semibold");
  expect(within(cardHead).getByText("example.org").className).toContain("text-muted-foreground");
  expect(actionNames(cardHead)).toEqual(["Open in new tab", "Embed in this chat"]);
  const open = within(cardHead).getByRole("link", { name: "Open in new tab" });
  expect(open.className).toContain("bg-primary");
  expect(open.getAttribute("target")).toBe("_blank");
  expect(open.getAttribute("href")).toBe(LINK.url);
  // Description and preview image stay below the head.
  expect(screen.getByText("What the page is about")).toBeTruthy();
  expect(card.querySelector("img")?.getAttribute("src")).toBe("/preview.png");
});

it("keeps the release of a link card a quiet action that releases the domain", () => {
  render(wrap(<LinkCards links={[LINK]} messageId="m" origin={{ senderName: "Ada" }} />));

  const embed = screen.getByRole("button", { name: "Embed in this chat" });
  expect(embed.className).not.toContain("bg-primary ");
  fireEvent.click(embed);
  expect(content.setDomainReleased).toHaveBeenCalledWith("example.org", true);
});

it("offers no release without the right to release", () => {
  content.canRelease = false;
  render(wrap(<LinkCards links={[LINK]} messageId="m" origin={{ senderName: "Ada" }} />));

  expect(screen.queryByRole("button", { name: "Embed in this chat" })).toBeNull();
});

it("names a link without title by its host and shows no body without preview", () => {
  render(
    wrap(
      <LinkCards
        links={[{ ...LINK, title: "", description: "", imageUrl: null }]}
        messageId="m"
        origin={{ senderName: "Ada" }}
      />,
    ),
  );

  const card = screen.getByRole("region", { name: "example.org" });
  expect(card.querySelector("img")).toBeNull();
  expect(card.querySelectorAll("a")).toHaveLength(1);
});

it("gives an embedded page the fixed order: new tab, reload, beside, full screen, collapse", () => {
  content.embeddable = true;
  content.expanded = true;
  render(wrap(<LinkCards links={[LINK]} messageId="m" origin={{ senderName: "Ada" }} />));

  const card = screen.getByRole("region", { name: "Example page" });
  const cardHead = head(card);
  expect(within(cardHead).getByText(/https:\/\/example\.org\/path/u)).toBeTruthy();
  expect(actionNames(cardHead)).toEqual([
    "Open in new tab",
    "Reload",
    "Beside",
    "Full screen",
    "Collapse",
  ]);
  expect(within(cardHead).getByRole("link", { name: "Open in new tab" }).className).toContain(
    "bg-primary",
  );
  expect(cardHead.querySelector("[aria-hidden='true'].bg-border")).toBeTruthy();
  // The page is framed only through the frame document of Pages, without referrer.
  const frame = card.querySelector("iframe");
  expect(frame?.getAttribute("src")).toBe(
    "/chat/embed?url=https%3A%2F%2Fexample.org%2Fpath&conversationId=conversation",
  );
  expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(card.querySelector("input")).toBeNull();
});

it("reloads the embedded page and opens it in full screen", () => {
  content.embeddable = true;
  content.expanded = true;
  render(wrap(<LinkCards links={[LINK]} messageId="m" origin={{ senderName: "Ada" }} />));

  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(document.querySelector("iframe")?.getAttribute("data-reload")).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
  expect(content.openOverlay).toHaveBeenCalledWith(
    expect.objectContaining({ key: "m:l0", descriptor: { kind: "web", link: LINK } }),
  );
});

it("lets a member take back a release of the embedded page", () => {
  content.embeddable = true;
  content.expanded = true;
  content.released = ["example.org"];
  render(wrap(<LinkCards links={[LINK]} messageId="m" origin={{ senderName: "Ada" }} />));

  fireEvent.click(screen.getByRole("button", { name: "Remove release" }));
  expect(content.setDomainReleased).toHaveBeenCalledWith("example.org", false);
});

it("gives a diff card the head Diff · +N −M and Copy as main action", () => {
  content.expanded = true;
  render(
    wrap(
      <DiffCard
        cardKey="d"
        name="changes"
        text={{ source: DIFF }}
        origin={{ senderName: "Ada" }}
      />,
    ),
  );

  const card = screen.getByRole("region", { name: "app.ts" });
  const cardHead = head(card);
  expect(cardHead.textContent).toContain("Diff · +2 −1");
  expect(actionNames(cardHead)).toEqual([
    "Copy",
    "Beside",
    "Full screen",
    "Collapse",
  ]);
  const copy = within(cardHead).getByRole("button", { name: "Copy" });
  expect(copy.className).toContain("bg-primary");
  fireEvent.click(copy);
  expect(content.copy).toHaveBeenCalledWith(DIFF);
  fireEvent.click(within(cardHead).getByRole("button", { name: "Full screen" }));
  expect(content.openOverlay).toHaveBeenCalledWith(
    expect.objectContaining({ key: "d", descriptor: expect.objectContaining({ kind: "diff" }) }),
  );
});

it("keeps Whole file as a framed action after Copy for a stored diff", () => {
  content.expanded = true;
  render(
    wrap(
      <DiffCard
        cardKey="d"
        name="changes"
        text={{ source: DIFF, sourceUrl: "/files/diff" }}
        origin={{ senderName: "Ada" }}
      />,
    ),
  );

  const cardHead = head(screen.getByRole("region", { name: "app.ts" }));
  expect(actionNames(cardHead).slice(0, 2)).toEqual(["Copy", "Whole file"]);
  const whole = within(cardHead).getByRole("link", { name: "Whole file" });
  expect(whole.getAttribute("href")).toBe("/files/diff?download=1");
  expect(whole.className).not.toContain("bg-primary ");
});

it("leads the diff panel with Copy and keeps the switch between stacked and side by side", () => {
  const card: OpenedCard = {
    key: "d",
    descriptor: { kind: "diff", name: "app.ts", source: DIFF },
    origin: { senderName: "Ada" },
  };
  render(wrap(<CardPanel card={card} onClose={() => undefined} onFullscreen={() => undefined} />));

  const panelHead = head(screen.getByRole("region", { name: "app.ts" }));
  expect(actionNames(panelHead)).toEqual([
    "Copy",
    "Stacked",
    "Side by side",
    "Full screen",
    "Close",
  ]);
  expect(within(panelHead).getByRole("button", { name: "Copy" }).className).toContain("bg-primary");
  const stacked = within(panelHead).getByRole("button", { name: "Stacked" });
  fireEvent.click(stacked);
  expect(stacked.getAttribute("aria-pressed")).toBe("true");
});

it("gives an embedded page in the panel new tab, reload, full screen and close", () => {
  const card: OpenedCard = {
    key: "w",
    descriptor: { kind: "web", link: LINK },
    origin: { senderName: "Ada" },
  };
  render(wrap(<CardPanel card={card} onClose={() => undefined} onFullscreen={() => undefined} />));

  const panel = screen.getByRole("region", { name: "Example page" });
  const panelHead = head(panel);
  expect(panelHead.textContent).toContain(LINK.url);
  expect(actionNames(panelHead)).toEqual(["Open in new tab", "Reload", "Full screen", "Close"]);
  fireEvent.click(within(panelHead).getByRole("button", { name: "Reload" }));
  expect(panel.querySelector("iframe")?.getAttribute("data-reload")).toBe("1");
});
