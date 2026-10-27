import { describe, expect, it } from "vitest";

import {
  CATALOG_INTERVALS,
  isCatalogInterval,
} from "@/definition/AgentModelCatalog";
import { isCapability, CAPABILITY } from "@/definition/Authorization";
import {
  isChatSessionId,
  readChatCommand,
  CHAT_COMMANDS,
} from "@/definition/Chat";
import {
  GITHUB_SYNC_INTERVAL,
  isGitHubSyncInterval,
  isProjectRole,
  isProjectStatus,
  publishesNewTasks,
  PROJECT_ROLE,
  PROJECT_STATUS,
} from "@/definition/Project";
import { isRole, ROLE } from "@/definition/Role";
import {
  isUserDateFormat,
  isUserTheme,
  isUserTimezone,
  isUserWeekStart,
  USER_DATE_FORMATS,
  USER_THEMES,
  USER_TIMEZONES,
} from "@/definition/Settings";
import {
  getWorkItemGitHubSyncState,
  isWorkItemPriority,
  isWorkItemType,
  normalizeHexColorCode,
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
} from "@/definition/Task";
import { isUser, isUserAvatarType } from "@/definition/User";
import { isLanguage, resolveLanguage } from "@/language/Language";
import { isTemplateScope, TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";
import { isWikiScope, WIKI_SCOPE } from "@/definition/Wiki";

import type { ProjectIntegration } from "@/definition/Project";

const UNTRUSTED = [undefined, null, 0, 1, true, {}, [], "", "__unknown__"];

describe.each([
  ["isRole", isRole, Object.values(ROLE)],
  ["isCapability", isCapability, Object.values(CAPABILITY)],
  ["isProjectRole", isProjectRole, Object.values(PROJECT_ROLE)],
  ["isProjectStatus", isProjectStatus, Object.values(PROJECT_STATUS)],
  ["isWorkItemType", isWorkItemType, Object.values(WORK_ITEM_TYPE)],
  ["isWorkItemPriority", isWorkItemPriority, Object.values(WORK_ITEM_PRIORITY)],
  ["isTemplateScope", isTemplateScope, Object.values(TEMPLATE_SCOPE)],
  ["isWikiScope", isWikiScope, Object.values(WIKI_SCOPE)],
  ["isUserTheme", isUserTheme, USER_THEMES],
  ["isUserDateFormat", isUserDateFormat, USER_DATE_FORMATS],
  ["isUserWeekStart", isUserWeekStart, ["monday", "sunday"]],
  ["isUserTimezone", isUserTimezone, USER_TIMEZONES],
  ["isLanguage", isLanguage, ["de", "en"]],
  ["isUserAvatarType", isUserAvatarType, ["initials", "icon", "image"]],
] as const)("%s", (_, guard, accepted) => {
  it.each(accepted)("accepts %j", (value) => {
    expect(guard(value)).toBe(true);
  });

  it.each(UNTRUSTED)("rejects the untrusted value %j", (value) => {
    expect(guard(value)).toBe(false);
  });
});

describe("numeric guards", () => {
  it("accepts only defined GitHub sync intervals", () => {
    for (const interval of Object.values(GITHUB_SYNC_INTERVAL)) {
      expect(isGitHubSyncInterval(interval)).toBe(true);
    }
    expect(isGitHubSyncInterval(7)).toBe(false);
    expect(isGitHubSyncInterval("5")).toBe(false);
  });

  it("accepts only defined catalog refresh intervals", () => {
    for (const interval of CATALOG_INTERVALS) {
      expect(isCatalogInterval(interval)).toBe(true);
    }
    expect(isCatalogInterval(12)).toBe(false);
  });
});

describe("isUser", () => {
  const user = {
    id: "u1",
    username: "anna",
    displayName: "Anna",
    role: "employee",
    isActive: true,
    mustChangePassword: false,
  };

  it("accepts a complete user with and without avatar type", () => {
    expect(isUser(user)).toBe(true);
    expect(isUser({ ...user, avatarType: "icon" })).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "anna"],
    ["a missing id", { ...user, id: undefined }],
    ["an unknown role", { ...user, role: "owner" }],
    ["a non-boolean flag", { ...user, isActive: "yes" }],
    ["an unknown avatar type", { ...user, avatarType: "hologram" }],
  ])("rejects %s", (_, candidate) => {
    expect(isUser(candidate)).toBe(false);
  });
});

describe("normalizeHexColorCode", () => {
  it.each([
    ["#ABCDEF", "#abcdef"],
    ["#f90", "#ff9900"],
    ["#00FF7f", "#00ff7f"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeHexColorCode(input)).toBe(expected);
  });

  it.each(["abcdef", "#abcd", "#ggg", "#12345678", "", null, 123])(
    "rejects %j",
    (input) => {
      expect(normalizeHexColorCode(input)).toBeNull();
    },
  );
});

describe("getWorkItemGitHubSyncState", () => {
  const synced = {
    githubIssueNumber: 7,
    githubConflict: false,
    githubLastError: null,
    githubLastSyncAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it.each([
    ["unlinked", { githubIssueNumber: null }],
    ["failed", { githubConflict: true }],
    ["failed", { githubLastError: "rate limited" }],
    ["pending", { githubLastSyncAt: null }],
    ["pending", { updatedAt: "2026-01-03T00:00:00.000Z" }],
    ["pending", { updatedAt: "not a date" }],
    ["synced", {}],
  ] as const)("derives %s", (expected, change) => {
    expect(getWorkItemGitHubSyncState({ ...synced, ...change })).toBe(expected);
  });
});

describe("publishesNewTasks", () => {
  const integration: ProjectIntegration = {
    projectId: "p",
    repoUrl: "https://github.com/example/repo",
    hasToken: true,
    syncIssues: true,
    syncStatus: false,
    syncComments: false,
    syncPullRequests: false,
    syncCommits: false,
    syncDirection: "bidirectional",
    syncIntervalMinutes: 0,
    isConnected: true,
    repoName: "example/repo",
    lastSyncAt: null,
    nextSyncAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    syncEnabled: true,
  };

  it("publishes when repository, token, switch, scope and direction allow it", () => {
    expect(publishesNewTasks(integration)).toBe(true);
    expect(publishesNewTasks({ ...integration, syncDirection: "push" })).toBe(
      true,
    );
  });

  it.each([
    ["without an integration", null],
    ["without a repository", { ...integration, repoUrl: "" }],
    ["without a token", { ...integration, hasToken: false }],
    ["when synchronization is off", { ...integration, syncEnabled: false }],
    ["without issues in scope", { ...integration, syncIssues: false }],
    ["in the pull direction", { ...integration, syncDirection: "pull" }],
  ] as const)("does not publish %s", (_, candidate) => {
    expect(publishesNewTasks(candidate)).toBe(false);
  });
});

describe("chat and language helpers", () => {
  it("accepts only five-word lowercase session identifiers", () => {
    expect(isChatSessionId("calm-red-fox-jumps-high")).toBe(true);
    for (const candidate of [
      "calm-red-fox-jumps",
      "calm-red-fox-jumps-high-up",
      "Calm-red-fox-jumps-high",
      "../../etc/passwd",
      "calm-red-fox-jumps-h1gh",
      42,
    ]) {
      expect(isChatSessionId(candidate)).toBe(false);
    }
  });

  it("reads typed commands case-insensitively and leaves other text alone", () => {
    for (const command of CHAT_COMMANDS) {
      expect(readChatCommand(`  ${command.toUpperCase()} `)).toBe(command);
    }
    expect(readChatCommand("please do it")).toBeNull();
  });

  it.each([
    [undefined, "en"],
    ["", "en"],
    ["de", "de"],
    ["de-AT,de;q=0.9,en;q=0.8", "de"],
    ["fr-FR, en-GB;q=0.8", "en"],
    ["fr, es", "en"],
    ["EN-us", "en"],
  ])("resolves the preference %j to %s", (preference, expected) => {
    expect(resolveLanguage(preference)).toBe(expected);
  });
});
