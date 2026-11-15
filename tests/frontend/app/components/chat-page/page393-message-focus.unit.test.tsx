import { act, render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ChatPageHistory } from "@/app/components/chat-page/chat-page-history";
import { createI18n } from "@/app/lib/i18n";

import { message, participant } from "./chat-page-fixture";

import type { ComponentProps } from "react";

const i18n = createI18n("en");
const ADA = participant("ada", { name: "Ada" });
const scrolled: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom lays nothing out; the history only asks the element to come into view.
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this.getAttribute("data-message-id") ?? "");
  };
});

afterEach(() => {
  vi.useRealTimers();
  scrolled.splice(0);
});

function history(
  props: Partial<ComponentProps<typeof ChatPageHistory>>,
): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <ChatPageHistory
        messages={[]}
        name="Ada"
        findParticipant={(id) => (id === ADA.id ? ADA : undefined)}
        {...props}
      />
    </I18nextProvider>
  );
}

it("scrolls to the message of a 'Zur Nachricht' link and marks it for a moment", () => {
  const view = render(
    history({
      messages: [
        message("m-1"),
        { ...message("m-2"), authorId: "ada" },
        message("m-3"),
      ],
      focusMessageId: "m-2",
    }),
  );
  const target = view.container.querySelector('[data-message-id="m-2"]');
  expect(scrolled).toEqual(["m-2"]);
  expect(target?.getAttribute("data-message-focus")).toBe("true");
  act(() => {
    vi.advanceTimersByTime(4_000);
  });
  expect(target?.hasAttribute("data-message-focus")).toBe(false);
  // A new message later does not jump back to the linked one.
  view.rerender(
    history({
      messages: [
        message("m-1"),
        { ...message("m-2"), authorId: "ada" },
        message("m-3"),
        message("m-4"),
      ],
      focusMessageId: "m-2",
    }),
  );
  expect(scrolled).toEqual(["m-2"]);
});

it("loads older pages until the linked message is shown", () => {
  const onLoad = vi.fn();
  const view = render(
    history({
      messages: [message("m-9")],
      focusMessageId: "m-1",
      older: { hasMore: true, isLoading: false, onLoad },
    }),
  );
  expect(onLoad).toHaveBeenCalledTimes(1);
  expect(scrolled).toEqual([]);
  view.rerender(
    history({
      messages: [message("m-1"), message("m-9")],
      focusMessageId: "m-1",
      older: { hasMore: false, isLoading: false, onLoad },
    }),
  );
  expect(scrolled).toEqual(["m-1"]);
  expect(onLoad).toHaveBeenCalledTimes(1);
});

it("leaves the history alone without a link or for a message it cannot find", () => {
  const onLoad = vi.fn();
  render(
    history({
      messages: [message("m-1")],
      focusMessageId: "gone",
      older: { hasMore: false, isLoading: false, onLoad },
    }),
  );
  render(history({ messages: [message("m-1")] }));
  expect(scrolled).toEqual([]);
  expect(onLoad).not.toHaveBeenCalled();
});
