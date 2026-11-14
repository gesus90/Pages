import { act, cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { ChatPageComposer } from "@/app/components/chat-page/chat-page-composer";
import { createI18n } from "@/app/lib/i18n";

import { installLayoutShims } from "../chat/chat-fixture";

vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn() }),
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));

let removeShims = (): void => undefined;
beforeAll(() => {
  removeShims = installLayoutShims();
});
afterAll(() => removeShims());

const i18n = createI18n("en");

function renderComposer(): {
  readonly mentionRef: { current: ((username: string) => void) | null };
} {
  const mentionRef: { current: ((username: string) => void) | null } = {
    current: null,
  };
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageComposer
        label="Message"
        placeholder="Write"
        onSend={vi.fn()}
        mentionRef={mentionRef}
      />
    </I18nextProvider>,
  );
  return { mentionRef };
}

async function field(): Promise<HTMLElement> {
  return screen.findByRole("textbox", { name: "Message" });
}

it("puts the mention into the empty input field", async () => {
  const { mentionRef } = renderComposer();
  const input = await field();
  await vi.waitFor(() => expect(mentionRef.current).not.toBeNull());
  act(() => mentionRef.current?.("ed-user"));
  expect(input.textContent).toBe("@ed-user ");
});

it("writes the mention after the text that is already there", async () => {
  const { mentionRef } = renderComposer();
  const input = await field();
  await vi.waitFor(() => expect(mentionRef.current).not.toBeNull());
  act(() => mentionRef.current?.("ed-user"));
  act(() => mentionRef.current?.("mei-user"));
  expect(input.textContent).toBe("@ed-user @mei-user ");
});

it("lets go of the mention handler when the field goes away", async () => {
  const { mentionRef } = renderComposer();
  await field();
  await vi.waitFor(() => expect(mentionRef.current).not.toBeNull());
  cleanup();
  expect(mentionRef.current).toBeNull();
});
