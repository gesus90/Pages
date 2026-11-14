import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { SplitPanel } from "@/app/components/chat-page/content/split-panel";
import { createI18n } from "@/app/lib/i18n";

import type { OpenedCard } from "@/app/components/chat-page/content/card-types";

const state = vi.hoisted(() => ({
  card: null as OpenedCard | null,
  submit: vi.fn<(form: FormData, options: { method: string }) => void>(),
  close: vi.fn(),
  overlay: vi.fn(),
}));
vi.mock("react-router", () => ({
  useFetcher: () => ({ submit: state.submit }),
}));
vi.mock("@/app/components/chat-page/content/chat-content-context", () => ({
  useChatContent: () => ({
    beside: state.card,
    closeBeside: state.close,
    openOverlay: state.overlay,
  }),
}));
vi.mock("@/app/components/chat-page/content/card-panel", () => ({
  CardPanel: ({
    onClose,
    onFullscreen,
    style,
  }: {
    onClose: () => void;
    onFullscreen: () => void;
    style: React.CSSProperties;
  }) => (
    <div style={style}>
      <button onClick={onClose}>Close</button>
      <button onClick={onFullscreen}>Full screen</button>
    </div>
  ),
}));

const card: OpenedCard = {
  key: "code",
  descriptor: {
    kind: "code",
    name: "file",
    languageHint: "ts",
    source: "hello",
  },
  origin: { senderName: "Ada" },
};

it("hides the split view until a card is open", () => {
  state.card = null;
  const { container } = render(
    <I18nextProvider i18n={createI18n("en")}>
      <SplitPanel storedWidth={null} />
    </I18nextProvider>,
  );
  expect(container.textContent).toBe("");
});

it("resizes with arrow keys, saves the width and forwards panel actions", () => {
  state.card = card;
  state.submit.mockClear();
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <SplitPanel storedWidth={500} />
    </I18nextProvider>,
  );
  const divider = screen.getByRole("separator");
  fireEvent.keyDown(divider, { key: "ArrowLeft" });
  expect(divider.getAttribute("aria-valuenow")).toBe("532");
  const submitted = state.submit.mock.calls[0]?.[0];
  expect(submitted?.get("intent")).toBe("split-width");
  expect(submitted?.get("width")).toBe("532");
  fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(state.overlay).toHaveBeenCalledWith(card);
  expect(state.close).toHaveBeenCalledOnce();
});
