/** Thrown when a username is already taken by another user. */
export class UsernameTakenError extends Error {
  public constructor(username: string) {
    super(`The username "${username}" is already taken.`);
  }
}

/** Thrown when an email address is already taken by another user. */
export class EmailTakenError extends Error {
  public constructor(email: string) {
    super(`The email address "${email}" is already taken.`);
  }
}

/** Thrown when an actor lacks the permission to manage users at all. */
export class UserManagementDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to manage users.");
  }
}

/** Thrown when an actor tries to assign or keep a role beyond their reach. */
export class RoleAssignmentDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to assign the requested role.");
  }
}

/** Thrown when a referenced user does not exist. */
export class UserNotFoundError extends Error {
  public constructor() {
    super("The requested user does not exist.");
  }
}

/** Thrown when an action would leave Pages without an active administrator. */
export class LastAdministratorError extends Error {
  public constructor() {
    super("The last active administrator cannot be deactivated.");
  }
}
