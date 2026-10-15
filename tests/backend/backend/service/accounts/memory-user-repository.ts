import { UserRepository } from "@/backend/database/repositories/UserRepository";
import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import type { Database } from "@/backend/database/Database";
import type {
  NewUser,
  StoredUserAvatar,
  UserCredentials,
} from "@/backend/database/repositories/UserRepository";
import type { Role } from "@/definition/Role";
import type { User, UserAvatarType } from "@/definition/User";

import type {
  MemoryAuthorizationStore,
  MemoryUserRecord,
} from "./memory-authorization-store";

/** A database that fails every access, so unexpected SQL is never silent. */
export const UNUSED_DATABASE: Pick<
  Database,
  "query" | "execute" | "transaction"
> = {
  query: async () => {
    throw new Error("Unexpected database query");
  },
  execute: async () => {
    throw new Error("Unexpected database write");
  },
  transaction: async () => {
    throw new Error("Unexpected database transaction");
  },
};

/** User persistence held in the memory store. */
export class MemoryUserRepository extends UserRepository {
  private readonly store: MemoryAuthorizationStore;
  public readonly avatars = new Map<string, StoredUserAvatar>();

  /** Binds the fake to the memory store. */
  public constructor(store: MemoryAuthorizationStore) {
    super(UNUSED_DATABASE);
    this.store = store;
  }

  /** Reads one user row. */
  public override async findById(id: string): Promise<User | null> {
    return this.store.users.get(id)?.user ?? null;
  }

  /** Reads every stored row. */
  public override async findAll(): Promise<User[]> {
    return [...this.store.users.values()]
      .map((record) => record.user)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  /** Finds the user carrying an address, ignoring case. */
  public override async findByEmail(email: string): Promise<User | null> {
    const wanted = email.toLowerCase();

    return (
      [...this.store.users.values()].find(
        (record) => record.email?.toLowerCase() === wanted,
      )?.user ?? null
    );
  }

  /** Reads the stored addresses of known users. */
  public override async findEmailsByUserIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>> {
    return new Map(
      ids.flatMap((id) => {
        const record = this.store.users.get(id);

        return record ? [[id, record.email] as const] : [];
      }),
    );
  }

  /** Finds credentials by username, ignoring case. */
  public override async findCredentialsByUsername(
    username: string,
  ): Promise<UserCredentials | null> {
    const wanted = username.toLowerCase();
    const record = [...this.store.users.values()].find(
      (candidate) => candidate.user.username.toLowerCase() === wanted,
    );

    return record
      ? { user: record.user, passwordHash: record.passwordHash }
      : null;
  }

  /** Stores a user and refuses a taken username like the unique index. */
  public override async insert(user: NewUser): Promise<void> {
    this.store.writes.push(`users.insert:${user.id}`);

    const taken = [...this.store.users.values()].some(
      (record) =>
        record.user.username.toLowerCase() === user.username.toLowerCase(),
    );

    if (taken) {
      throw new UsernameTakenError(user.username);
    }

    this.store.users.set(user.id, {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        isActive: user.isActive ?? true,
        mustChangePassword: user.mustChangePassword ?? false,
      },
      email: user.email ?? null,
      passwordHash: user.passwordHash,
    });
  }

  /** Changes the sign-in state of a user. */
  public override async setActive(
    id: string,
    isActive: boolean,
  ): Promise<void> {
    this.store.writes.push(`users.setActive:${id}:${String(isActive)}`);
    this.change(id, (record) => ({
      ...record,
      user: { ...record.user, isActive },
    }));
  }

  /** Replaces display name, username and email. */
  public override async updateProfile(
    id: string,
    profile: {
      readonly displayName: string;
      readonly username: string;
      readonly email: string | null;
      readonly avatarType?: UserAvatarType;
      readonly avatarImageUrl?: string | null;
    },
  ): Promise<void> {
    this.store.writes.push(`users.updateProfile:${id}`);
    this.requireFreeIdentity(id, profile);
    this.change(id, (record) => ({
      ...record,
      email: profile.email,
      user: {
        ...record.user,
        displayName: profile.displayName,
        username: profile.username,
      },
    }));
  }

  /** Replaces the legacy project role of a user. */
  public override async updateRole(id: string, role: Role): Promise<void> {
    this.store.writes.push(`users.updateRole:${id}:${role}`);
    this.change(id, (record) => ({
      ...record,
      user: { ...record.user, role },
    }));
  }

  /** Replaces the hash and clears the forced change. */
  public override async updatePasswordHash(
    id: string,
    passwordHash: string,
  ): Promise<void> {
    this.store.writes.push(`users.updatePasswordHash:${id}`);
    this.change(id, (record) => ({
      ...record,
      passwordHash,
      user: { ...record.user, mustChangePassword: false },
    }));
  }

  /** Replaces the hash and forces a password change. */
  public override async resetPasswordHash(
    id: string,
    passwordHash: string,
  ): Promise<void> {
    this.store.writes.push(`users.resetPasswordHash:${id}`);
    this.change(id, (record) => ({
      ...record,
      passwordHash,
      user: { ...record.user, mustChangePassword: true },
    }));
  }

  /** Counts active accounts with administrator eligibility. */
  public override async countActiveAdministrators(): Promise<number> {
    return this.store
      .readAccounts()
      .filter((account) => account.isAdmin && account.isActive).length;
  }

  /** Stores an avatar image. */
  public override async upsertAvatar(
    userId: string,
    avatar: StoredUserAvatar,
  ): Promise<void> {
    this.store.writes.push(`users.upsertAvatar:${userId}`);
    this.avatars.set(userId, {
      mimeType: avatar.mimeType,
      filename: avatar.filename,
      data: avatar.data,
    });
  }

  /** Reads a stored avatar image. */
  public override async findAvatarByUserId(
    userId: string,
  ): Promise<StoredUserAvatar | null> {
    return this.avatars.get(userId) ?? null;
  }

  /** Replaces the avatar reference of a user. */
  public override async updateAvatarReference(
    id: string,
    avatar: {
      readonly avatarType: UserAvatarType;
      readonly avatarImageUrl: string | null;
    },
  ): Promise<void> {
    this.store.writes.push(`users.updateAvatarReference:${id}`);
    this.change(id, (record) => ({
      ...record,
      user: {
        ...record.user,
        avatarType: avatar.avatarType,
        avatarImageUrl: avatar.avatarImageUrl,
      },
    }));
  }

  private requireFreeIdentity(
    id: string,
    profile: { readonly username: string; readonly email: string | null },
  ): void {
    const others = [...this.store.users.values()].filter(
      (record) => record.user.id !== id,
    );

    if (
      others.some(
        (record) =>
          record.user.username.toLowerCase() === profile.username.toLowerCase(),
      )
    ) {
      throw new UsernameTakenError(profile.username);
    }

    if (
      profile.email !== null &&
      others.some((r) => r.email === profile.email)
    ) {
      throw new EmailTakenError(profile.email);
    }
  }

  private change(
    id: string,
    update: (record: MemoryUserRecord) => MemoryUserRecord,
  ): void {
    const record = this.store.users.get(id);

    if (record) {
      this.store.users.set(id, update(record));
    }
  }
}
