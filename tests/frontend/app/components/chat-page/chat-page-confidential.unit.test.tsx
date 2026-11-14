import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import {
  ConfidentialButton,
  useConfidential,
} from "@/app/components/chat-page/chat-page-confidential";
import { createI18n } from "@/app/lib/i18n";

import { group, participant } from "./chat-page-fixture";

const fetcher = vi.hoisted(() => ({
  formData: undefined as FormData | undefined,
  submit: vi.fn<(form: FormData, options: { method: string }) => void>(),
}));
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));

beforeEach(() => {
  fetcher.formData = undefined;
  fetcher.submit.mockReset();
});

it("submits the opposite state for an agent and shows the pending state", () => {
  const opened = {
    kind: "participant",
    participant: participant("ada"),
  } as const;
  const { result, rerender } = renderHook(() => useConfidential(opened));
  expect(result.current.isConfidential).toBe(false);
  act(() => result.current.onToggle());
  const submitted = fetcher.submit.mock.calls[0][0];
  expect(submitted.get("intent")).toBe("confidential");
  expect(submitted.get("agentId")).toBe("ada");
  expect(submitted.get("isConfidential")).toBe("true");
  fetcher.formData = submitted;
  rerender();
  expect(result.current.isConfidential).toBe(true);
});

it("submits a group identifier and ignores a pending request for another chat", () => {
  fetcher.formData = new FormData();
  fetcher.formData.set("conversationId", "other");
  fetcher.formData.set("isConfidential", "false");
  const opened = {
    kind: "group",
    group: group("team", { isConfidential: true }),
    members: [],
  } as const;
  const { result } = renderHook(() => useConfidential(opened));
  expect(result.current.isConfidential).toBe(true);
  act(() => result.current.onToggle());
  expect(fetcher.submit.mock.calls[0][0].get("conversationId")).toBe("team");
  expect(fetcher.submit.mock.calls[0][0].get("isConfidential")).toBe("false");
});

it("offers no toggle for a person or missing conversation", () => {
  const opened = {
    kind: "participant",
    participant: participant("person", { kind: "human" }),
  } as const;
  const { result, rerender } = renderHook(
    ({ current }) => useConfidential(current),
    { initialProps: { current: opened } },
  );
  expect(result.current.isConfidential).toBeNull();
  act(() => result.current.onToggle());
  expect(fetcher.submit).not.toHaveBeenCalled();
  rerender({ current: opened });
});

it("renders the toggle state and invokes its callback", () => {
  const onToggle = vi.fn();
  const { rerender } = render(
    <I18nextProvider i18n={createI18n("en")}>
      <ConfidentialButton control={{ isConfidential: false, onToggle }} />
    </I18nextProvider>,
  );
  const button = screen.getByRole("button");
  expect(button.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(button);
  expect(onToggle).toHaveBeenCalledOnce();
  rerender(
    <I18nextProvider i18n={createI18n("en")}>
      <ConfidentialButton control={{ isConfidential: null, onToggle }} />
    </I18nextProvider>,
  );
  expect(screen.queryByRole("button")).toBeNull();
});
