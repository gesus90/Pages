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

/** Validation failures of a project department selection. */
export type ProjectDepartmentErrorCode =
  "departmentRequired" | "invalidDepartment" | "departmentOutOfScope";

/** Preserves a field-specific error for project creation and reassignment. */
export class ProjectDepartmentError extends Error {
  public readonly code: ProjectDepartmentErrorCode;

  /** Records a validated selection failure without exposing account facts. */
  public constructor(code: ProjectDepartmentErrorCode) {
    super(code);
    this.code = code;
  }
}
