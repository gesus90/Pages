/** Thrown when a project does not exist or has already been archived. */
export class ProjectNotFoundError extends Error {
  public constructor() {
    super("The requested project does not exist.");
  }
}

/** Thrown when an actor may not read a project they are not assigned to. */
export class ProjectAccessDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to access the requested project.");
  }
}

/** Thrown when an actor may not create or change projects. */
export class ProjectManagementDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to manage projects.");
  }
}
