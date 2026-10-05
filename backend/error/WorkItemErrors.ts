/** Thrown when a requested work item does not exist or has been archived. */
export class WorkItemNotFoundError extends Error {
  public constructor() {
    super("The requested work item does not exist.");
  }
}

/** Thrown when a work item action violates hierarchy rules. */
export class WorkItemHierarchyError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

/** Thrown when a work item payload fails validation. */
export class WorkItemValidationError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

/** Thrown when an actor lacks access to the project associated with a task. */
export class WorkItemAccessDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to access tasks for this project.");
  }
}
