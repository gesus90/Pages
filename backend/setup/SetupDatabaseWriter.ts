import { randomUUID } from "node:crypto";

import { PermissionService } from "@/backend/auth/PermissionService";
import { SessionService } from "@/backend/auth/SessionService";
import { InstanceSettingsRepository } from "@/backend/database/repositories/InstanceSettingsRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { UserService } from "@/backend/service/UserService";
import { ROLE } from "@/definition/Role";

import type { Database } from "@/backend/database/Database";
import type { Language } from "@/language/Language";

/** Validated values the setup stores in the database. */
export interface SetupRecord {
  readonly companyName: string;
  readonly username: string;
  readonly email: string | null;
  readonly passwordHash: string;
  /** Language of the wizard, kept as the administrator's language. */
  readonly language: Language;
  /** Raw user agent of the browser that finishes the setup. */
  readonly userAgent: string | null;
}

/** Outcome of writing the setup into a database. */
export type SetupWriteResult =
  | {
      readonly status: "written";
      /** Session token of the administrator, for the browser cookie only. */
      readonly sessionToken: string;
    }
  | { readonly status: "usernameTaken" }
  | { readonly status: "emailTaken" };

/**
 * Writes the company and the main administrator of a setup into a
 * migrated database and signs the administrator in.
 *
 * @remarks
 * Writing the same setup again leads to the same state, so a setup whose
 * configuration could not be stored can simply be finished again.
 */
export class SetupDatabaseWriter {
  private readonly users: UserRepository;
  private readonly sessionRepository: SessionRepository;
  private readonly sessions: SessionService;
  private readonly instanceSettings: InstanceSettingsRepository;
  private readonly userSettings: UserSettingsRepository;

  /**
   * Creates a writer for one database.
   *
   * @param database - Open and migrated database.
   */
  public constructor(database: Database) {
    this.users = new UserRepository(database);
    this.sessionRepository = new SessionRepository(database);
    this.sessions = new SessionService(
      this.sessionRepository,
      new UserService(this.users, new PermissionService()),
    );
    this.instanceSettings = new InstanceSettingsRepository(database);
    this.userSettings = new UserSettingsRepository(database);
  }

  /**
   * Stores the setup.
   *
   * @param record - Validated setup values with the hashed password.
   * @returns `written` with a new session, or why the account was refused.
   *
   * @remarks
   * An existing administrator with the same username is updated: password,
   * email (when given), active again, and every older session revoked. An
   * existing user without administrator rights is never turned into the
   * administrator. Other users and all data stay untouched.
   */
  public async write(record: SetupRecord): Promise<SetupWriteResult> {
    const existing = await this.users.findCredentialsByUsername(
      record.username,
    );

    if (existing && existing.user.role !== ROLE.ADMIN) {
      return { status: "usernameTaken" };
    }

    const existingId = existing?.user.id ?? null;

    if (await this.isEmailTakenByOther(record.email, existingId)) {
      return { status: "emailTaken" };
    }

    const administratorId =
      existing === null
        ? await this.createAdministrator(record)
        : await this.updateAdministrator(existing.user, record);

    await this.instanceSettings.save({
      companyName: record.companyName,
      primaryAdministratorId: administratorId,
    });
    await this.userSettings.upsertLanguage(administratorId, record.language);

    return {
      sessionToken: await this.sessions.createSession(
        administratorId,
        record.userAgent,
      ),
      status: "written",
    };
  }

  private async isEmailTakenByOther(
    email: string | null,
    ownId: string | null,
  ): Promise<boolean> {
    if (email === null) {
      return false;
    }

    const owner = await this.users.findByEmail(email);

    return owner !== null && owner.id !== ownId;
  }

  private async createAdministrator(record: SetupRecord): Promise<string> {
    const id = randomUUID();

    await this.users.insert({
      displayName: record.username,
      email: record.email,
      id,
      passwordHash: record.passwordHash,
      role: ROLE.ADMIN,
      username: record.username,
    });

    return id;
  }

  private async updateAdministrator(
    user: { readonly id: string; readonly displayName: string },
    record: SetupRecord,
  ): Promise<string> {
    if (record.email !== null) {
      await this.users.updateProfile(user.id, {
        displayName: user.displayName,
        email: record.email,
        username: record.username,
      });
    }

    await this.users.updatePasswordHash(user.id, record.passwordHash);
    await this.users.setActive(user.id, true);
    await this.sessionRepository.deleteAllByUserId(user.id);

    return user.id;
  }
}
