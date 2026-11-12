import { fireEvent, render, screen } from "@testing-library/react";
import { File } from "lucide-react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import {
  CardAction,
  ContentCard,
} from "@/app/components/chat-page/content/content-card";
import { createI18n } from "@/app/lib/i18n";

import type { OpenedCard } from "@/app/components/chat-page/content/card-types";

const state = vi.hoisted(() => ({
  expanded: true,
  beside: false,
  setState: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/app/components/chat-page/content/chat-content-context", () => ({
  useChatContent: () => ({
    stateOf: () => (state.expanded ? "expanded" : "collapsed"),
    beside: state.beside ? { key: "card" } : null,
    setState: state.setState,
    openBeside: state.open,
    closeBeside: state.close,
  }),
}));

const card: OpenedCard = {
  key: "card",
  descriptor: { kind: "code", name: "file", languageHint: "", source: "text" },
  origin: { senderName: "Ada" },
};

function view(): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n("en")}>
      <ContentCard
        cardKey="card"
        icon={File}
        name="file"
        kindLabel="Code"
        meta="3 lines"
        defaultState="expanded"
        beside={card}
        actions={<span>Extra</span>}
      >
        Body
      </ContentCard>
    </I18nextProvider>
  );
}

it("shows expanded content and opens or closes the beside view", () => {
  state.expanded = true;
  state.beside = false;
  state.open.mockClear();
  state.close.mockClear();
  state.setState.mockClear();
  const { rerender } = render(view());
  expect(screen.getByRole("region", { name: "file" }).textContent).toContain(
    "Code · 3 lines",
  );
  expect(screen.getByText("Body")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Beside" }));
  expect(state.open).toHaveBeenCalledWith(card);
  fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
  expect(state.setState).toHaveBeenCalledWith("card", "collapsed");
  state.beside = true;
  state.expanded = false;
  rerender(view());
  expect(screen.queryByText("Body")).toBeNull();
  expect(screen.queryByText("Extra")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Opened on the right" }));
  expect(state.close).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Expand" }));
  expect(state.setState).toHaveBeenCalledWith("card", "expanded");
});

it("renders accessible icon-only actions and link destinations", () => {
  const click = vi.fn();
  render(
    <>
      <CardAction
        label="Toggle"
        icon={File}
        isIconOnly
        isActive
        onClick={click}
      />
      <CardAction label="Download" href="/file" />
      <CardAction label="Open" href="/file" isNewTab />
    </>,
  );
  const button = screen.getByRole("button", { name: "Toggle" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(button.getAttribute("title")).toBe("Toggle");
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("link", { name: "Download" }).hasAttribute("download"),
  ).toBe(true);
  expect(screen.getByRole("link", { name: "Open" }).getAttribute("rel")).toBe(
    "noopener noreferrer",
  );
});
