import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatContentProvider } from "@/app/components/chat-page/content/chat-content-context";
import { ReferenceCards } from "@/app/components/chat-page/content/reference-cards";
import { createI18n } from "@/app/lib/i18n";

import type {
  ConversationAttachment,
  ConversationAttachmentReference,
} from "@/definition/ConversationContent";

vi.mock("react-router", () => ({ useFetcher: () => ({ submit: vi.fn() }) }));

/** Previews load only when seen; jsdom has no observer, so nothing is ever seen. */
class HiddenObserver {
  /** No-op intersection observe stub. */
  public observe(): void {}
  /** No-op intersection unobserve stub. */
  public unobserve(): void {}
  /** No-op intersection disconnect stub. */
  public disconnect(): void {}
}

const i18n = createI18n("de");

const ZIP: ConversationAttachment = {
  id: "zip-1",
  name: "build.zip",
  mimeType: "application/zip",
  sizeBytes: 4096,
  kind: "file",
  url: "/chat/files/zip-1",
  createdAt: "2026-11-15T08:00:00.000Z",
  sha256: "b".repeat(64),
};

function reference(
  overrides: Partial<ConversationAttachmentReference> = {},
): ConversationAttachmentReference {
  return {
    attachmentId: ZIP.id,
    state: "available",
    attachment: ZIP,
    name: ZIP.name,
    sourceMessageId: "msg-source",
    senderName: "Conan",
    sentAt: "2026-11-15T08:00:00.000Z",
    ...overrides,
  };
}

function renderCards(
  references: readonly ConversationAttachmentReference[],
): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ChatContentProvider
        conversationId="conv-1"
        conversationKey="entry"
        directory={{ viewPreferences: { cardStates: {}, splitWidth: null } }}
      >
        <article data-chat-message="msg-source" tabIndex={-1}>
          Originalnachricht
        </article>
        <article data-chat-message="msg-answer" tabIndex={-1}>
          <ReferenceCards references={references} />
        </article>
      </ChatContentProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", HiddenObserver);
});

describe("PAGE-386 cards of earlier attachments", () => {
  it("shows the normal card of the original with its origin and goes to its message", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderCards([reference()]);
    expect(
      screen.getByText("aus einer früheren Nachricht von Conan"),
    ).toBeTruthy();
    // The original's own card: no copy, the same file and checksum.
    expect(screen.getByText("build.zip")).toBeTruthy();
    const card = document.querySelector('[data-attachment-reference="zip-1"]');
    expect(card?.getAttribute("data-reference-state")).toBe("available");
    expect(card?.innerHTML).toContain("/chat/files/zip-1");
    fireEvent.click(screen.getByRole("button", { name: "Zur Nachricht" }));
    const source = document.querySelector('[data-chat-message="msg-source"]');
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(source);
  });

  it("shows an expired original as abgelaufen and a deleted one as gelöscht", () => {
    renderCards([
      reference({
        state: "expired",
        attachment: {
          ...ZIP,
          expiresAt: "2026-11-15T09:00:00.000Z",
          expiredAt: "2026-11-15T09:00:00.000Z",
        },
      }),
      reference({ attachmentId: "gone", state: "deleted", name: "alt.csv" }),
    ]);
    expect(
      document.querySelector(
        '[data-reference-state="expired"] [data-attachment-expired]',
      ),
    ).toBeTruthy();
    const deleted = document.querySelector('[data-reference-state="deleted"]');
    expect(deleted?.textContent).toContain("alt.csv");
    expect(deleted?.textContent).toContain("gelöscht");
    expect(deleted?.querySelector("button")).toBeNull();
  });

  it("renders nothing without references", () => {
    renderCards([]);
    expect(document.querySelector("[data-reference-cards]")).toBeNull();
  });
});
