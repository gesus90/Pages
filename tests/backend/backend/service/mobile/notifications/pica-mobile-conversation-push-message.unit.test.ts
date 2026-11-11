import { expect, it } from "vitest";

import { buildPicaMobileConversationPushMessage } from "@/backend/service/mobile/notifications/PicaMobileConversationPushMessage";

import type { PicaMobileConversationPushInput } from "@/backend/service/mobile/notifications/PicaMobileConversationPushMessage";

function input(
  overrides: Partial<PicaMobileConversationPushInput> = {},
): PicaMobileConversationPushInput {
  return {
    token: "native-token",
    instanceId: "instance-1",
    accountId: "account-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    createdAt: "2026-03-01T12:00:00.000Z",
    locale: "en",
    preview: "details",
    senderName: "Anna",
    groupName: null,
    isVoice: false,
    ttlSeconds: 600,
    ...overrides,
  };
}

it("names the sender in title and body of a direct conversation", () => {
  expect(buildPicaMobileConversationPushMessage(input())).toEqual({
    token: "native-token",
    title: "Anna",
    body: "Message from Anna",
    data: {
      pica_v: "1",
      pica_type: "conversation_message",
      pica_instance: "instance-1",
      pica_account: "account-1",
      pica_conversation: "conversation-1",
      pica_message: "message-1",
      pica_at: "2026-03-01T12:00:00.000Z",
      tag: "conversation:conversation-1",
    },
    channelId: "pica-conversation-messages",
    tag: "conversation:conversation-1",
    ttlSeconds: 600,
  });
});

it("titles a group message with the group and names the sender in the body", () => {
  const message = buildPicaMobileConversationPushMessage(
    input({ groupName: "  Release\n team  " }),
  );

  expect(message.title).toBe("Release team");
  expect(message.body).toBe("Message from Anna");
});

it.each([
  ["en", "Voice message from Anna"],
  ["de", "Sprachnachricht von Anna"],
] as const)("words a voice message in %s", (locale, body) => {
  expect(
    buildPicaMobileConversationPushMessage(input({ locale, isVoice: true }))
      .body,
  ).toBe(body);
});

it("words a text message in German", () => {
  const message = buildPicaMobileConversationPushMessage(
    input({ locale: "de", groupName: "Team" }),
  );

  expect(message.title).toBe("Team");
  expect(message.body).toBe("Nachricht von Anna");
});

it.each([
  ["en", "New message", "Unlock to view details."],
  ["de", "Neue Nachricht", "Zum Anzeigen der Details entsperren."],
] as const)(
  "names nobody when the device chose a hidden preview (%s)",
  (locale, title, body) => {
    const message = buildPicaMobileConversationPushMessage(
      input({
        locale,
        preview: "hidden",
        groupName: "Secret group",
        senderName: "Anna",
      }),
    );

    expect(message.title).toBe(title);
    expect(message.body).toBe(body);
    expect(JSON.stringify(message)).not.toContain("Anna");
    expect(JSON.stringify(message)).not.toContain("Secret group");
  },
);

it("falls back to the generic text when the sender name is empty after cleaning", () => {
  const message = buildPicaMobileConversationPushMessage(
    input({ senderName: " \t\u0007  ", groupName: "Team" }),
  );

  expect(message.title).toBe("New message");
  expect(message.body).toBe("Unlock to view details.");
});

it("drops control characters and collapses white space in names", () => {
  const message = buildPicaMobileConversationPushMessage(
    input({ senderName: "An\u0000na    Meyer" }),
  );

  expect(message.title).toBe("An na Meyer");
  expect(message.body).toBe("Message from An na Meyer");
});

it("keeps a name of eighty characters and shortens a longer one with an ellipsis", () => {
  const exact = "a".repeat(80);
  const longer = `${"😀".repeat(80)}x`;

  expect(
    buildPicaMobileConversationPushMessage(input({ senderName: exact })).title,
  ).toBe(exact);
  expect(
    buildPicaMobileConversationPushMessage(input({ senderName: longer })).title,
  ).toBe(`${"😀".repeat(79)}…`);
});
