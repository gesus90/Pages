import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import {
  ChatContentProvider,
  useChatContent,
} from "@/app/components/chat-page/content/chat-content-context";

import type { ConversationLink } from "@/definition/ConversationContent";
import type { ReactNode } from "react";

const submit = vi.hoisted(() =>
  vi.fn<(form: FormData, options: { method: string }) => void>(),
);
vi.mock("react-router", () => ({ useFetcher: () => ({ submit }) }));

const link: ConversationLink = {
  url: "https://other.example/path",
  domain: "other.example",
  title: "",
  description: "",
  imageUrl: null,
  embeddable: false,
};

it("provides safe standalone defaults", () => {
  const { result } = renderHook(() => useChatContent());
  expect(result.current.stateOf("card", "expanded")).toBe("expanded");
  expect(result.current.isEmbeddable(link)).toBe(false);
  expect(result.current.canRelease).toBe(false);
});

it("remembers card choices, submits stored keys and checks embed releases", () => {
  submit.mockClear();
  function wrapper({
    children,
  }: {
    readonly children: ReactNode;
  }): React.ReactElement {
    return (
      <ChatContentProvider
        conversationId="conversation"
        conversationKey="entry"
        directory={{
          viewPreferences: {
            cardStates: { saved: "collapsed" },
            splitWidth: null,
          },
          embedDomains: {
            global: ["global.example"],
            byConversation: { conversation: ["other.example"] },
          },
        }}
      >
        {children}
      </ChatContentProvider>
    );
  }
  const { result } = renderHook(() => useChatContent(), { wrapper });
  expect(result.current.stateOf("saved", "expanded")).toBe("collapsed");
  expect(result.current.isEmbeddable(link)).toBe(true);
  expect(
    result.current.isEmbeddable({ ...link, domain: "global.example" }),
  ).toBe(true);
  expect(
    result.current.isEmbeddable({
      ...link,
      url: window.location.origin + "/page",
      domain: "local",
    }),
  ).toBe(true);
  expect(
    result.current.isEmbeddable({ ...link, url: "invalid", domain: "unknown" }),
  ).toBe(false);
  act(() => {
    result.current.setState("pending:1", "collapsed");
  });
  expect(submit).not.toHaveBeenCalled();
  expect(result.current.stateOf("pending:1", "expanded")).toBe("collapsed");
  act(() => {
    result.current.setState("saved", "expanded");
    result.current.setDomainReleased("other.example", false);
  });
  expect(result.current.stateOf("saved", "collapsed")).toBe("expanded");
  expect(submit).toHaveBeenCalledTimes(2);
  const cardForm = submit.mock.calls[0]?.[0];
  const domainForm = submit.mock.calls[1]?.[0];
  if (!cardForm || !domainForm) throw new Error("Missing submissions");
  expect(Array.from(cardForm.entries())).toEqual([
    ["intent", "card-state"],
    ["cardKey", "saved"],
    ["state", "expanded"],
  ]);
  expect(Array.from(domainForm.entries())).toEqual([
    ["intent", "embed-domain"],
    ["conversationId", "conversation"],
    ["domain", "other.example"],
    ["isReleased", "false"],
  ]);
});
