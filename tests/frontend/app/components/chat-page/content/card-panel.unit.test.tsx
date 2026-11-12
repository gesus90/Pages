import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import {
  CardOverlay,
  CardPanel,
} from "@/app/components/chat-page/content/card-panel";
import { createI18n } from "@/app/lib/i18n";

import type { OpenedCard } from "@/app/components/chat-page/content/card-types";

const actions = vi.hoisted(() => ({
  copy: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
  overlay: { current: null as OpenedCard | null },
}));

vi.mock("@/app/components/chat-page/content/chat-content-context", () => ({
  useChatContent: () => ({
    conversationId: "conversation",
    overlay: actions.overlay.current,
    closeOverlay: actions.close,
  }),
}));
vi.mock("@/app/components/chat-page/content/use-card-text", () => ({
  useCardText: (descriptor: { source: string | null }) => ({
    source: descriptor.source,
    isFailed: false,
  }),
  copyText: actions.copy,
  saveTextFile: actions.save,
}));
vi.mock("@/app/components/chat-page/content/code-view", () => ({
  CodeView: ({ source }: { source: string }) => <div>{source}</div>,
}));
vi.mock("@/app/components/chat-page/content/diff-view", () => ({
  useParsedDiff: (source: string) => source,
  DiffView: ({ layout }: { layout: string }) => <div>Layout: {layout}</div>,
  DiffCount: () => <span>diff count</span>,
}));
vi.mock("@/app/components/chat-page/content/chat-markdown", () => ({
  ChatMarkdown: ({ source }: { source: string }) => <div>{source}</div>,
}));
vi.mock("@/app/components/chat-page/content/attachment-full-view", () => ({
  AttachmentFullView: () => <div>Attachment body</div>,
}));
vi.mock("@/app/components/chat-page/content/link-cards", () => ({
  WebView: () => <div>Web body</div>,
}));

function wrap(element: React.ReactNode): React.ReactElement {
  return <I18nextProvider i18n={createI18n("en")}>{element}</I18nextProvider>;
}

const code: OpenedCard = {
  key: "code",
  descriptor: {
    kind: "code",
    name: "example.txt",
    languageHint: "",
    source: "hello",
  },
  origin: { senderName: "Ada" },
};

it("shows code and invokes copy, save, fullscreen and close actions", () => {
  const close = vi.fn();
  const fullscreen = vi.fn();
  render(
    wrap(<CardPanel card={code} onClose={close} onFullscreen={fullscreen} />),
  );
  expect(
    screen.getByRole("region", { name: "example.txt" }).textContent,
  ).toContain("Ada");
  expect(screen.getByText("hello")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  fireEvent.click(screen.getByRole("button", { name: "As file" }));
  fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(actions.copy).toHaveBeenCalledWith("hello");
  expect(actions.save).toHaveBeenCalledWith("example.txt", "hello");
  expect(fullscreen).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

it("switches diff layout and shows a loading state for missing text", () => {
  const diff: OpenedCard = {
    ...code,
    descriptor: { kind: "diff", name: "changes", source: "diff" },
  };
  const { rerender } = render(
    wrap(<CardPanel card={diff} onClose={() => undefined} />),
  );
  expect(screen.getByText("Layout: split")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stacked" }));
  expect(screen.getByText("Layout: unified")).toBeTruthy();
  expect(screen.getByText("diff count")).toBeTruthy();
  const loading: OpenedCard = {
    ...code,
    descriptor: { kind: "markdown", name: "notes", source: null },
  };
  rerender(wrap(<CardPanel card={loading} onClose={() => undefined} />));
  expect(screen.getByRole("status").textContent).toContain("Loading content");
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
});

it("opens a link in a new tab and closes the overlay with Escape", () => {
  const link: OpenedCard = {
    ...code,
    descriptor: {
      kind: "link",
      link: {
        url: "https://example.org/path",
        domain: "example.org",
        title: "",
        description: "",
        imageUrl: null,
        embeddable: false,
      },
    },
  };
  actions.overlay.current = link;
  actions.close.mockReset();
  const { unmount } = render(wrap(<CardOverlay />));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Web body")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "New tab" }).getAttribute("href"),
  ).toBe("https://example.org/path");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(actions.close).toHaveBeenCalledOnce();
  unmount();
  actions.overlay.current = null;
});
