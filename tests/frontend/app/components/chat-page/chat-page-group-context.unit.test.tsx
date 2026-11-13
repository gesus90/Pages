import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { ChatPageGroupContext } from "@/app/components/chat-page/chat-page-group-context";
import { createI18n } from "@/app/lib/i18n";

import type {
  ConversationGroupContextView,
  ConversationObserverStatus,
} from "@/definition/ConversationObserver";
import type { VirtualGroup } from "@/definition/VirtualChat";

const fetcher = vi.hoisted(() => {
  const handle: {
    data: unknown;
    state: "idle";
    readonly submit: ReturnType<
      typeof vi.fn<(formData: FormData, options: { method: string }) => void>
    >;
  } = {
    data: undefined,
    state: "idle",
    submit: vi.fn(),
  };
  return handle;
});
vi.mock("react-router", () => ({
  useFetcher: () => fetcher,
}));

const i18n = createI18n("en");

const GROUP: VirtualGroup = {
  id: "group-1",
  name: "Planner",
  description: "A group",
  memberIds: ["ada"],
  unreadCount: 0,
  lastActivityAt: "2026-11-12T10:00:00.000Z",
};

function view(
  overrides: Partial<ConversationGroupContextView> = {},
): ConversationGroupContextView {
  return {
    conversationId: "group-1",
    status: "behind",
    summary: "The plan stands.",
    decisions: [],
    openItems: [],
    responsibilities: [],
    updatedAt: null,
    throughSequence: 4,
    pendingMessages: 2,
    hasExcerpts: false,
    sources: [],
    errorCode: null,
    ...overrides,
  };
}

function observer(
  overrides: Partial<ConversationObserverStatus> = {},
): ConversationObserverStatus {
  return {
    consecutiveFailures: 2,
    lastFailure: {
      kind: "routing",
      state: "failed",
      code: "check_timeout",
      at: "2026-11-12T09:30:00.000Z",
    },
    ...overrides,
  };
}

function renderContext(): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageGroupContext group={GROUP} isOpen onOpenChange={vi.fn()} />
    </I18nextProvider>,
  );
}

function contextWithData(
  overrides: Partial<ConversationGroupContextView> = {},
): void {
  fetcher.data = { ok: true, groupContext: view(overrides) };
}

beforeEach(() => {
  fetcher.data = undefined;
  fetcher.state = "idle";
  fetcher.submit.mockReset();
});

it("shows the observer failure with cause, count and hint", () => {
  contextWithData({ observer: observer() });
  renderContext();
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("no result for the last 2");
  expect(alert.textContent).toContain("while routing");
  expect(alert.textContent).toContain("did not answer in time");
  expect(alert.textContent).toContain("ACP resources");
});

it("names an unknown failure code as it is", () => {
  contextWithData({
    observer: observer({
      lastFailure: {
        kind: "summary",
        state: "refused",
        code: "mystery_code",
        at: "2026-11-12T09:30:00.000Z",
      },
    }),
  });
  renderContext();
  expect(screen.getByRole("alert").textContent).toContain("mystery_code");
});

it("shows no failure notice while the observer succeeds", () => {
  contextWithData({
    observer: observer({ consecutiveFailures: 0, lastFailure: null }),
  });
  renderContext();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("The plan stands.")).toBeTruthy();
});

it("shows no failure notice without observer status", () => {
  contextWithData({});
  renderContext();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reads the context whenever the dialog opens and not while it is closed", () => {
  function dialog(isOpen: boolean): React.ReactElement {
    return (
      <I18nextProvider i18n={i18n}>
        <ChatPageGroupContext
          group={GROUP}
          isOpen={isOpen}
          onOpenChange={vi.fn()}
        />
      </I18nextProvider>
    );
  }
  const { rerender } = render(dialog(false));
  expect(fetcher.submit).not.toHaveBeenCalled();
  rerender(dialog(true));
  expect(fetcher.submit).toHaveBeenCalledTimes(1);
  const [formData, options] = fetcher.submit.mock.calls[0] ?? [];
  expect(Object.fromEntries(formData?.entries() ?? [])).toEqual({
    intent: "group-context",
    conversationId: "group-1",
  });
  expect(options).toEqual({ method: "post" });
});
