import { PicaAuthorizationError } from "@/backend/error/PicaAuthorizationError";
import { CAPABILITY } from "@/definition/Authorization";

import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { UserService } from "@/backend/service/UserService";
import type { Capability } from "@/definition/Authorization";

/** The current account rights used by a Pica operation. */
export interface PicaIdentity {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly permissions: readonly Capability[];
}

/** Resolves current account rights without changing the browser's role mode. */
export class PicaIdentityService {
  private readonly users: Pick<UserService, "getById">;
  private readonly administration: Pick<AdministrationService, "getContext">;

  public constructor(
    users: Pick<UserService, "getById">,
    administration: Pick<AdministrationService, "getContext">,
  ) {
    this.users = users;
    this.administration = administration;
  }

  /** Loads fresh facts and refuses inactive or mandatory-password accounts. */
  public async verify(userId: string): Promise<PicaIdentity> {
    const user = await this.users.getById(userId);
    if (!user || !user.isActive || user.mustChangePassword)
      throw new PicaAuthorizationError();
    const account = await this.administration.getContext(userId);
    if (!account.isActive) throw new PicaAuthorizationError();
    return {
      userId,
      isAdmin: account.isAdmin,
      permissions: account.isAdmin
        ? Object.values(CAPABILITY)
        : (account.role?.permissions ?? []),
    };
  }
}
