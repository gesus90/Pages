import { strict as assert } from "node:assert";

import { call, MISSING_TEXT, prepare, refused, stored } from "./world";

import type { RepositoryFlow } from "./world";

const USER_COLUMNS = {
  passwordHash: "hash-1",
  mustChangePassword: false,
} as const;

const AVATAR = {
  mimeType: "image/png",
  filename: "bild ä.png",
  data: Buffer.from([0, 1, 2, 255, 39, 92]),
};

const SETTINGS = {
  language: "en",
  theme: null,
  timezone: "Europe/Berlin",
  dateFormat: "YYYY-MM-DD",
  weekStart: null,
  notifyEmail: true,
  notifyDesktop: false,
  notifyMentions: null,
  notifyAssignments: true,
  notifyDueDates: null,
  notifyWeeklySummary: false,
} as const;

/** Benutzer: accounts, profile, avatars and passwords. */
export const USER_FLOW: RepositoryFlow = {
  title: "users",
  steps: [
    call("provisionAccount", ({ users }) =>
      users.insert({
        ...USER_COLUMNS,
        id: "user-manager",
        username: "Anna.Müller",
        displayName: "Zoë Manager",
        role: "manager",
        email: "anna@example.test",
      }),
    ),
    call("UserRepository.insert", ({ users }) =>
      users.insert({
        ...USER_COLUMNS,
        id: "user-employee",
        username: "bert",
        displayName: "Ärger, Bert",
        role: "employee",
        createdAt: "2026-01-02 03:04:05",
      }),
    ),
    call("UserRepository.insert", ({ users }) =>
      users.insert({
        ...USER_COLUMNS,
        id: "user-admin",
        username: "root's $name -- x",
        displayName: "admin",
        role: "admin",
        isActive: true,
        mustChangePassword: true,
      }),
    ),
    call("UserRepository.insert", ({ users }) =>
      users.insert({
        ...USER_COLUMNS,
        id: "user-same-name-a",
        username: "same-a",
        displayName: "Same Name",
        role: "employee",
      }),
    ),
    call("UserRepository.insert", ({ users }) =>
      users.insert({
        ...USER_COLUMNS,
        id: "user-same-name-b",
        username: "same-b",
        displayName: "Same Name",
        role: "employee",
        isActive: false,
      }),
    ),
    stored(`
      SELECT user_id, role_id, is_admin, active_mode, first_name, last_name, all_projects
      FROM user_authorization
      ORDER BY user_id;
    `),
    stored("SELECT id, created_at FROM users WHERE id = 'user-employee';"),
    stored(
      "SELECT id, name, hierarchy_rank, department_bound FROM roles ORDER BY id;",
    ),
    stored(
      "SELECT role_id, permission FROM role_permissions ORDER BY role_id, permission;",
    ),
    call("UserRepository.findById", ({ users }) =>
      users.findById("user-admin"),
    ),
    call("UserRepository.findById", ({ users }) => users.findById("nobody")),
    // An update moves a row in PostgreSQL only, which shows a sort without a unique last key.
    prepare(
      "UPDATE users SET updated_at = updated_at WHERE id = 'user-same-name-a';",
    ),
    call("UserRepository.findAll", ({ users }) => users.findAll()),
    call("UserRepository.findByEmail", ({ users }) =>
      users.findByEmail("anna@example.test"),
    ),
    call("UserRepository.findByEmail", ({ users }) =>
      users.findByEmail("nobody@example.test"),
    ),
    call("UserRepository.findEmailsByUserIds", ({ users }) =>
      users.findEmailsByUserIds([]),
    ),
    call("UserRepository.findEmailsByUserIds", ({ users }) =>
      users.findEmailsByUserIds(["user-manager", "user-employee", "nobody"]),
    ),
    call("UserRepository.findCredentialsByUsername", async ({ users }) => {
      const credentials = await users.findCredentialsByUsername("ANNA.MÜLLER");
      assert.equal(credentials?.user.id, "user-manager");
      assert.equal(credentials?.passwordHash, "hash-1");
      return credentials;
    }),
    call("UserRepository.findCredentialsByUsername", ({ users }) =>
      users.findCredentialsByUsername("nobody"),
    ),
    refused("UserRepository.insert", ({ users }) =>
      users.insert({
        ...USER_COLUMNS,
        id: "user-taken",
        username: "anna.müller",
        displayName: "Taken",
        role: "employee",
      }),
    ),
    refused("UserRepository.insert", ({ users }) =>
      users.insert({
        ...USER_COLUMNS,
        id: "user-manager",
        username: "other",
        displayName: "Duplicate id",
        role: "employee",
      }),
    ),
    call("stored", async ({ database }) => {
      const rows = await database.query("SELECT COUNT(*) FROM users;");
      assert.deepEqual(rows, [[5]]);
      return rows;
    }),
    call("stored", async ({ database }) => {
      const rows = await database.query(
        "SELECT user_id FROM user_authorization WHERE user_id = 'user-taken';",
      );
      assert.deepEqual(rows, []);
      return rows;
    }),
    prepare(`
      INSERT INTO personal_agent_tokens (id, user_id, name, token_hash, created_at)
      VALUES ('token-1', 'user-employee', 'Laptop', 'token-hash-1', 1000);
    `),
    prepare(`
      INSERT INTO user_groups (id, name) VALUES ('group-set-active', 'Set active');
      INSERT INTO user_group_members (group_id, user_id) VALUES ('group-set-active', 'user-employee');
    `),
    call("UserRepository.setActive", ({ users }) =>
      users.setActive("user-employee", false),
    ),
    stored(`
      SELECT revoked_at IS NOT NULL, previous_token_hash, rotation_requested_at
      FROM personal_agent_tokens;
    `),
    stored(
      "SELECT COUNT(*) FROM user_group_members WHERE user_id = 'user-employee';",
    ),
    call("UserRepository.setActive", ({ users }) =>
      users.setActive("user-employee", true),
    ),
    call("UserRepository.findById", ({ users }) =>
      users.findById("user-employee"),
    ),
    call("UserRepository.updateProfile", ({ users }) =>
      users.updateProfile("user-employee", {
        displayName: "Bert Ärger",
        username: "bert2",
        email: "bert@example.test",
        avatarType: "image",
        avatarImageUrl: "/avatar/bert",
      }),
    ),
    call("UserRepository.updateProfile", ({ users }) =>
      users.updateProfile("user-employee", {
        displayName: "Bert Ärger",
        username: "bert2",
        email: "bert@example.test",
      }),
    ),
    call("UserRepository.findById", ({ users }) =>
      users.findById("user-employee"),
    ),
    refused("UserRepository.updateProfile", ({ users }) =>
      users.updateProfile("user-employee", {
        displayName: "Bert",
        username: "ANNA.müller",
        email: null,
      }),
    ),
    refused("UserRepository.updateProfile", ({ users }) =>
      users.updateProfile("user-employee", {
        displayName: "Bert",
        username: "bert2",
        email: "anna@example.test",
      }),
    ),
    call("UserRepository.updateAvatarReference", ({ users }) =>
      users.updateAvatarReference("user-employee", {
        avatarType: "initials",
        avatarImageUrl: null,
      }),
    ),
    call("UserRepository.findAvatarByUserId", ({ users }) =>
      users.findAvatarByUserId("user-employee"),
    ),
    call("UserRepository.findAvatarDigestByUserId", ({ users }) =>
      users.findAvatarDigestByUserId("user-employee"),
    ),
    call("UserRepository.upsertAvatar", ({ users }) =>
      users.upsertAvatar("user-employee", AVATAR),
    ),
    call("UserRepository.findAvatarByUserId", ({ users }) =>
      users.findAvatarByUserId("user-employee"),
    ),
    call("UserRepository.findAvatarDigestByUserId", ({ users }) =>
      users.findAvatarDigestByUserId("user-employee"),
    ),
    call("UserRepository.upsertAvatar", ({ users }) =>
      users.upsertAvatar("user-employee", {
        ...AVATAR,
        data: Buffer.from("zweites Bild"),
      }),
    ),
    call("UserRepository.findAvatarByUserId", ({ users }) =>
      users.findAvatarByUserId("user-employee"),
    ),
    call("UserRepository.deleteAvatar", ({ users }) =>
      users.deleteAvatar("user-employee"),
    ),
    refused("UserRepository.upsertAvatar", ({ users }) =>
      users.upsertAvatar("user-admin", { ...AVATAR, filename: MISSING_TEXT }),
    ),
    call("UserRepository.updateRole", ({ users }) =>
      users.updateRole("user-employee", "manager"),
    ),
    call("UserRepository.findById", ({ users }) =>
      users.findById("user-employee"),
    ),
    call("UserRepository.updatePasswordHash", ({ users }) =>
      users.updatePasswordHash("user-admin", "hash-2"),
    ),
    call("UserRepository.findCredentialsByUsername", ({ users }) =>
      users.findCredentialsByUsername("root's $name -- x"),
    ),
    prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES ('session-reset', 'user-admin', 'session-reset-hash', '2999-01-01 00:00:00');
    `),
    call("UserRepository.resetPasswordHash", ({ users }) =>
      users.resetPasswordHash("user-admin", "hash-3"),
    ),
    call("UserRepository.findCredentialsByUsername", ({ users }) =>
      users.findCredentialsByUsername("root's $name -- x"),
    ),
    stored("SELECT COUNT(*) FROM sessions WHERE user_id = 'user-admin';"),
    call("UserRepository.countActiveAdministrators", ({ users }) =>
      users.countActiveAdministrators(),
    ),
  ],
};

/** Anmeldung: a session from its start to its end. */
export const SESSION_FLOW: RepositoryFlow = {
  title: "login",
  steps: [
    call("SessionRepository.insert", ({ sessions }) =>
      sessions.insert({
        id: "session-a",
        userId: "user-manager",
        tokenHash: "token-a",
        lifetimeDays: 30,
        userAgent: "Browser A",
      }),
    ),
    call("SessionRepository.insert", ({ sessions }) =>
      sessions.insert({
        id: "session-b",
        userId: "user-manager",
        tokenHash: "token-b",
        lifetimeDays: 1,
      }),
    ),
    call("SessionRepository.insert", ({ sessions }) =>
      sessions.insert({
        id: "session-inactive",
        userId: "user-same-name-b",
        tokenHash: "token-inactive",
        lifetimeDays: 30,
      }),
    ),
    stored(`
      SELECT
          id,
          user_agent,
          expires_at > utc_after(INTERVAL '29 days'),
          expires_at <= utc_after(INTERVAL '31 days')
      FROM sessions
      WHERE user_id IN ('user-manager', 'user-same-name-b')
      ORDER BY id;
    `),
    refused("SessionRepository.insert", ({ sessions }) =>
      sessions.insert({
        id: "session-a",
        userId: "user-manager",
        tokenHash: "token-other",
        lifetimeDays: 30,
      }),
    ),
    call("SessionRepository.findUserIdByTokenHash", ({ sessions }) =>
      sessions.findUserIdByTokenHash("token-a"),
    ),
    call("SessionRepository.findUserIdByTokenHash", ({ sessions }) =>
      sessions.findUserIdByTokenHash("nothing"),
    ),
    call("SessionRepository.findIdByTokenHash", ({ sessions }) =>
      sessions.findIdByTokenHash("token-a"),
    ),
    call("SessionRepository.isActive", ({ sessions }) =>
      sessions.isActive("session-a", "user-manager"),
    ),
    call("SessionRepository.isActive", ({ sessions }) =>
      sessions.isActive("session-a", "user-admin"),
    ),
    prepare(
      "UPDATE sessions SET last_used_at = '2020-01-01 00:00:00' WHERE id = 'session-a';",
    ),
    call("SessionRepository.markUsed", ({ sessions }) =>
      sessions.markUsed("token-a"),
    ),
    stored(
      "SELECT last_used_at > '2021-01-01 00:00:00' FROM sessions WHERE id = 'session-a';",
    ),
    prepare(
      "UPDATE sessions SET last_used_at = utc_after(INTERVAL '10 minutes') WHERE id = 'session-b';",
    ),
    call("SessionRepository.markUsed", ({ sessions }) =>
      sessions.markUsed("token-b"),
    ),
    stored(
      "SELECT last_used_at > utc_after(INTERVAL '5 minutes') FROM sessions WHERE id = 'session-b';",
    ),
    prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at, last_used_at)
      VALUES
          ('session-c', 'user-manager', 'token-c', '2999-01-01 00:00:00', '2025-01-01 00:00:00'),
          ('session-d', 'user-manager', 'token-d', '2999-01-01 00:00:00', '2025-01-01 00:00:00'),
          ('session-old', 'user-manager', 'token-old', '2001-01-01 00:00:00', '2025-06-01 00:00:00');
    `),
    prepare(`
      UPDATE sessions
      SET last_used_at = '2024-01-01 00:00:00'
      WHERE id IN ('session-a', 'session-b');
    `),
    prepare("UPDATE sessions SET user_agent = 'x' WHERE id = 'session-c';"),
    call("SessionRepository.listActiveByUserId", ({ sessions }) =>
      sessions.listActiveByUserId("user-manager", "token-d"),
    ),
    call("SessionRepository.listActiveByUserId", ({ sessions }) =>
      sessions.listActiveByUserId("user-manager", "token-a"),
    ),
    call("SessionRepository.findUserIdByTokenHash", ({ sessions }) =>
      sessions.findUserIdByTokenHash("token-old"),
    ),
    call("SessionRepository.findTokenHashByIdAndUserId", ({ sessions }) =>
      sessions.findTokenHashByIdAndUserId("session-c", "user-manager"),
    ),
    call("SessionRepository.findTokenHashByIdAndUserId", ({ sessions }) =>
      sessions.findTokenHashByIdAndUserId("session-old", "user-manager"),
    ),
    call("SessionRepository.deleteExpired", ({ sessions }) =>
      sessions.deleteExpired(),
    ),
    stored("SELECT id FROM sessions WHERE id = 'session-old';"),
    call("SessionRepository.deleteByIdAndUserId", ({ sessions }) =>
      sessions.deleteByIdAndUserId("session-d", "user-admin"),
    ),
    stored("SELECT COUNT(*) FROM sessions WHERE id = 'session-d';"),
    call("SessionRepository.deleteByIdAndUserId", ({ sessions }) =>
      sessions.deleteByIdAndUserId("session-d", "user-manager"),
    ),
    call("SessionRepository.deleteByTokenHash", ({ sessions }) =>
      sessions.deleteByTokenHash("token-c"),
    ),
    call("SessionRepository.deleteAllExceptTokenHash", ({ sessions }) =>
      sessions.deleteAllExceptTokenHash("user-manager", "token-a"),
    ),
    stored("SELECT id FROM sessions ORDER BY id;"),
    call("SessionRepository.deleteAllByUserId", ({ sessions }) =>
      sessions.deleteAllByUserId("user-manager"),
    ),
    stored("SELECT COUNT(*) FROM sessions;"),
  ],
};

/** Personal settings and the board view of a person. */
export const SETTINGS_FLOW: RepositoryFlow = {
  title: "personal settings",
  steps: [
    call("UserSettingsRepository.findLanguageByUserId", ({ settings }) =>
      settings.findLanguageByUserId("user-admin"),
    ),
    call("UserSettingsRepository.findByUserId", ({ settings }) =>
      settings.findByUserId("user-admin"),
    ),
    call("UserSettingsRepository.findDesignThemeId", ({ settings }) =>
      settings.findDesignThemeId("user-admin"),
    ),
    call("UserSettingsRepository.upsertDesignTheme", ({ settings }) =>
      settings.upsertDesignTheme("user-admin", "arctic"),
    ),
    call("UserSettingsRepository.findByUserId", ({ settings }) =>
      settings.findByUserId("user-admin"),
    ),
    call("UserSettingsRepository.findDesignThemeId", ({ settings }) =>
      settings.findDesignThemeId("user-admin"),
    ),
    call("UserSettingsRepository.upsertLanguage", ({ settings }) =>
      settings.upsertLanguage("user-admin", "en"),
    ),
    call("UserSettingsRepository.upsertLanguage", ({ settings }) =>
      settings.upsertLanguage("user-manager", "de"),
    ),
    call("UserSettingsRepository.findLanguageByUserId", ({ settings }) =>
      settings.findLanguageByUserId("user-admin"),
    ),
    call("UserSettingsRepository.upsert", ({ settings }) =>
      settings.upsert("user-admin", SETTINGS),
    ),
    call("UserSettingsRepository.findByUserId", ({ settings }) =>
      settings.findByUserId("user-admin"),
    ),
    call("UserSettingsRepository.findDesignThemeId", ({ settings }) =>
      settings.findDesignThemeId("user-admin"),
    ),
    refused("UserSettingsRepository.upsert", ({ settings }) =>
      settings.upsert("user-admin", { ...SETTINGS, dateFormat: "invalid" }),
    ),
    call("UserBoardPreferencesRepository.findByUserId", ({ boards }) =>
      boards.findByUserId("user-admin"),
    ),
    call("UserBoardPreferencesRepository.upsert", ({ boards }) =>
      boards.upsert("user-admin", '{"project":"project-gone"}'),
    ),
    call("UserBoardPreferencesRepository.upsert", ({ boards }) =>
      boards.upsert("user-manager", "kein JSON"),
    ),
    call("UserBoardPreferencesRepository.upsert", ({ boards }) =>
      boards.upsert("user-employee", '{"project":"other"}'),
    ),
    call("UserBoardPreferencesRepository.upsert", ({ boards }) =>
      boards.upsert("user-employee", '{"project":"übrig"}'),
    ),
    call("UserBoardPreferencesRepository.findByUserId", ({ boards }) =>
      boards.findByUserId("user-employee"),
    ),
    refused("UserBoardPreferencesRepository.upsert", ({ boards }) =>
      boards.upsert("user-admin", MISSING_TEXT),
    ),
  ],
};
