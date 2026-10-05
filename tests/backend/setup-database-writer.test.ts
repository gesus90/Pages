import { describe, expect, it } from "vitest";

import { InstanceSettingsRepository } from "@/backend/database/repositories/InstanceSettingsRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { SetupDatabaseWriter } from "@/backend/setup/SetupDatabaseWriter";
import { ROLE } from "@/definition/Role";

import { useMigratedDatabase } from "../helpers/test-database";

import type { SetupRecord } from "@/backend/setup/SetupDatabaseWriter";

const RECORD: SetupRecord = {
  companyName: "Pages GmbH",
  email: "chef@example.com",
  language: "en",
  passwordHash: "scrypt$new",
  userAgent: "Mozilla/5.0 Firefox/130.0",
  username: "chef",
};

describe("SetupDatabaseWriter", () => {
  const getDatabase = useMigratedDatabase();

  async function countSessions(userId: string): Promise<number> {
    const rows = await getDatabase().query(
      "SELECT COUNT(*) FROM sessions WHERE user_id = $user_id;",
      { user_id: userId },
    );

    return Number(rows[0]?.[0]);
  }

  it("creates the main administrator, the company, and a session", async () => {
    const result = await new SetupDatabaseWriter(getDatabase()).write(RECORD);

    expect(result.status).toBe("written");

    const credentials = await new UserRepository(
      getDatabase(),
    ).findCredentialsByUsername("chef");

    expect(credentials).toMatchObject({
      passwordHash: "scrypt$new",
      user: { displayName: "chef", isActive: true, role: ROLE.ADMIN },
    });

    const userId = credentials?.user.id ?? "";

    await expect(
      new InstanceSettingsRepository(getDatabase()).find(),
    ).resolves.toEqual({
      companyName: "Pages GmbH",
      primaryAdministratorId: userId,
    });
    await expect(
      new UserSettingsRepository(getDatabase()).findLanguageByUserId(userId),
    ).resolves.toBe("en");
    expect(await countSessions(userId)).toBe(1);
    expect(
      await new UserRepository(getDatabase()).findByEmail("chef@example.com"),
    ).toMatchObject({ id: userId });
  });

  it("updates an existing administrator with the same username", async () => {
    const users = new UserRepository(getDatabase());

    await users.insert({
      displayName: "Die Chefin",
      email: "alt@example.com",
      id: "admin-1",
      isActive: false,
      passwordHash: "scrypt$old",
      role: ROLE.ADMIN,
      username: "chef",
    });
    await new SessionRepository(getDatabase()).insert({
      id: "old-session",
      lifetimeDays: 14,
      tokenHash: "old-hash",
      userId: "admin-1",
    });

    const result = await new SetupDatabaseWriter(getDatabase()).write({
      ...RECORD,
      companyName: "Neu AG",
    });

    expect(result.status).toBe("written");
    await expect(users.findCredentialsByUsername("chef")).resolves.toEqual({
      passwordHash: "scrypt$new",
      user: expect.objectContaining({
        displayName: "Die Chefin",
        id: "admin-1",
        isActive: true,
      }),
    });
    await expect(users.findByEmail("chef@example.com")).resolves.toMatchObject({
      id: "admin-1",
    });
    expect(await countSessions("admin-1")).toBe(1);
    await expect(
      new InstanceSettingsRepository(getDatabase()).find(),
    ).resolves.toEqual({
      companyName: "Neu AG",
      primaryAdministratorId: "admin-1",
    });
  });

  it("keeps the email of an updated administrator when none is given", async () => {
    const users = new UserRepository(getDatabase());

    await users.insert({
      displayName: "chef",
      email: "chef@example.com",
      id: "admin-1",
      passwordHash: "scrypt$old",
      role: ROLE.ADMIN,
      username: "chef",
    });

    await new SetupDatabaseWriter(getDatabase()).write({
      ...RECORD,
      email: null,
    });

    await expect(users.findByEmail("chef@example.com")).resolves.toMatchObject({
      id: "admin-1",
    });
  });

  it("never turns an account without administrator rights into the administrator", async () => {
    const users = new UserRepository(getDatabase());

    await users.insert({
      displayName: "Team",
      id: "team-1",
      passwordHash: "scrypt$team",
      role: ROLE.EMPLOYEE,
      username: "chef",
    });

    await expect(
      new SetupDatabaseWriter(getDatabase()).write(RECORD),
    ).resolves.toEqual({ status: "usernameTaken" });
    await expect(users.findCredentialsByUsername("chef")).resolves.toEqual({
      passwordHash: "scrypt$team",
      user: expect.objectContaining({ role: ROLE.EMPLOYEE }),
    });
    await expect(
      new InstanceSettingsRepository(getDatabase()).find(),
    ).resolves.toBeNull();
  });

  it("refuses an email address another account uses", async () => {
    await new UserRepository(getDatabase()).insert({
      displayName: "Team",
      email: "chef@example.com",
      id: "team-1",
      passwordHash: "scrypt$team",
      role: ROLE.EMPLOYEE,
      username: "team",
    });

    await expect(
      new SetupDatabaseWriter(getDatabase()).write(RECORD),
    ).resolves.toEqual({ status: "emailTaken" });
  });
});
