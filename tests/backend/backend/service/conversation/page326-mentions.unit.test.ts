import { describe, expect, it } from "vitest";

import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationAliasDirectory } from "@/backend/service/conversation/ConversationMentionAliases";
import { findConversationMentions } from "@/backend/service/conversation/ConversationMentions";

import type { ConversationAccount } from "@/backend/service/conversation/ConversationDirectory";
import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type { AccountAccess } from "@/definition/Authorization";

function account(
  id: string,
  isAgent: boolean,
  isAvailable = true,
): ConversationAccount {
  return {
    user: {
      id,
      username: id,
      displayName: id,
      role: "employee",
      isAgent,
      isActive: isAvailable,
      mustChangePassword: false,
    },
    participant: {
      id,
      name: id,
      kind: isAgent ? "agent" : "human",
      color: null,
    },
    role: "",
    isAvailable,
  };
}

function access(userId: string, departments: readonly string[]): AccountAccess {
  return {
    userId,
    departments,
    isActive: true,
    isAdmin: false,
    isAgent: false,
    mode: "role",
    role: null,
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: true,
    firstName: "User",
    lastName: userId,
  };
}

const snapshot: AuthorizationSnapshot = {
  roles: [],
  departments: [
    { id: "dev", name: "Entwicklung" },
    { id: "secret", name: "Secret" },
  ],
  accounts: [
    access("person", ["dev"]),
    access("ed", ["dev"]),
    access("bakuman", ["secret"]),
  ],
};

function accounts(): ConversationAccounts {
  const entries = [
    account("person", false),
    account("ed", true),
    account("bakuman", true),
    account("outside", true),
    account("off", true, false),
  ];
  return new ConversationAccounts(
    new Map(entries.map((entry) => [entry.user.id, entry])),
    new ConversationAliasDirectory(snapshot, [
      { id: "a", name: "A-Team", memberIds: ["person", "ed", "outside"] },
      { id: "hidden", name: "Secret-Team", memberIds: ["outside"] },
    ]),
  );
}

const memberIds = ["person", "ed", "bakuman", "off"];

describe("PAGE-326 collective mentions", () => {
  it.each(["alle", "all", "team", "ALLE"])(
    "@%s reaches active agent members once, never humans, outsiders or sender",
    (alias) => {
      expect(
        findConversationMentions(`@${alias} @ed @all.`, memberIds, {
          accounts: accounts(),
          senderId: "person",
        }),
      ).toEqual(["ed", "bakuman"]);
      expect(
        findConversationMentions(`@${alias}`, memberIds, {
          accounts: accounts(),
          senderId: "ed",
        }),
      ).toEqual(["bakuman"]);
    },
  );

  it("expands visible groups and departments only into current agent members", () => {
    const directory = accounts();
    expect(directory.aliasesFor("person").map((entry) => entry.name)).toEqual([
      "a-team",
      "entwicklung",
    ]);
    expect(
      findConversationMentions(
        "@a-team @entwicklung @secret @secret-team",
        memberIds,
        { accounts: directory, senderId: "person" },
      ),
    ).toEqual(["ed"]);
  });

  it("does not turn email addresses or unknown aliases into mentions", () => {
    expect(
      findConversationMentions("person@all @unknown @@team", memberIds, {
        accounts: accounts(),
        senderId: "person",
      }),
    ).toEqual([]);
  });
});
