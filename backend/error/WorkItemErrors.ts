/**
 * Reasons a work item action is rejected, with the message logged for each.
 *
 * @remarks
 * The code is what the client receives; it translates the code into the
 * language of the user (`tasks.error.<code>`). The English message stays for
 * logs and tests.
 */
export const WORK_ITEM_ERROR_MESSAGES = {
  assigneeAndGroup:
    "A ticket is assigned to a person or to a group, not to both.",
  assigneeNoProjectAccess:
    "Selected assignee does not have access to this project.",
  checklistItemNotFound: "Selected checklist item does not exist.",
  checklistTitleEmpty: "Checklist item title must not be empty.",
  dependencyExists: "These milestones are already linked.",
  dependencyNotFound: "Selected dependency does not exist.",
  dependencyPairInvalid:
    "Dependencies require two milestones of the same project.",
  dependencySelf: "A milestone cannot depend on itself.",
  dependencyTypeUnsupported: "Unsupported dependency type.",
  departmentNotFound: "Selected department does not exist.",
  attachmentFileEmpty: "An attachment must not be empty.",
  attachmentFileNameTooLong: "The file name of an attachment is too long.",
  attachmentTooLarge: "The attachment exceeds the upload limit.",
  descendantsHidden: "The ticket has descendants that are not visible to you.",
  descriptionConflict:
    "The description was changed by someone else since it was opened.",
  descriptionTooLong: "Description must not exceed 65,536 characters.",
  epicMissing: "The specified Epic does not exist.",
  epicOtherProject: "Parent Epic must belong to the same project.",
  epicParentType: "An Epic can only belong to an Initiative.",
  epicSelfParent: "An Epic cannot be its own parent.",
  githubIssueNotDismissable: "This GitHub issue cannot be dismissed.",
  githubIssueNotImportable: "This GitHub issue cannot be imported.",
  githubIssueNotLinkable: "This GitHub issue cannot be linked.",
  githubNoConflict: "This task has no sync conflict.",
  githubNotConnected: "GitHub integration is not connected.",
  githubOnlyTasksLinkable: "Only tasks can be linked to a GitHub issue.",
  githubPullRequestNotAssignable: "This pull request cannot be assigned.",
  githubPullRequestOtherProject:
    "Pull requests can only reference tasks of the same project.",
  githubSyncSwitchedOff:
    "GitHub synchronization is switched off for this project.",
  githubTaskAlreadyLinked: "This task is already linked to a GitHub issue.",
  githubTaskNotLinked: "This task is not linked to a GitHub issue.",
  groupEmpty: "Selected group has no members.",
  groupNotFound: "Selected group does not exist.",
  initiativeMissing: "The specified Initiative does not exist.",
  invalidTreeKey: "The branch of the ticket tree is unknown.",
  initiativeNoParent: "An Initiative cannot have a parent work item.",
  initiativeOtherProject: "Parent Initiative must belong to the same project.",
  labelColorUnsupported: "Unsupported label color.",
  labelNameLength: "Label name must be between 1 and 40 characters.",
  labelNameTaken: "A label with this name already exists.",
  labelNotFound: "Selected label does not exist.",
  linkNotOfTicket: "Selected link does not belong to this ticket.",
  linkSelf: "A ticket cannot be linked to itself.",
  linkTargetNotFound: "Selected ticket does not exist.",
  linkTypeUnsupported: "Unsupported link type.",
  milestoneColorUnsupported: "Milestone color must be a supported color type.",
  milestoneCustomColorFormat:
    "Milestone custom color must use the format #RRGGBB.",
  milestoneDateOrder: "Milestone start date must not be after its due date.",
  milestoneDueDateFormat: "Milestone due date must use the format YYYY-MM-DD.",
  milestoneIconUnsupported: "Milestone icon must be a supported symbol.",
  milestoneNameLength: "Milestone name must be between 1 and 200 characters.",
  milestoneNotFound: "Selected milestone does not exist.",
  milestoneOtherProject: "Milestone does not belong to the selected project.",
  milestoneStartDateFormat:
    "Milestone start date must use the format YYYY-MM-DD.",
  milestoneStatusUnsupported: "Unsupported milestone status.",
  moveSameProject: "The ticket already belongs to the selected project.",
  parentArchived: "The selected parent is archived.",
  parentTaskMissing: "The specified parent task does not exist.",
  parentTaskOtherProject: "Parent task must belong to the same project.",
  priorityUnsupported: "Unsupported work item priority.",
  reporterRequired: "A reporter must be selected.",
  statusNotFound: "Selected status does not exist.",
  subtaskParentRequired: "A Subtask must have an associated parent task.",
  subtaskParentType: "A Subtask can only be attached to a Task.",
  subtaskSelfParent: "A Subtask cannot be its own parent.",
  subtasksStayWithTask: "Subtasks always go along with their task.",
  targetStatusNotFound: "Target status does not exist.",
  taskParentType: "A Task can only have an Epic as its parent.",
  taskSelfParent: "A Task cannot be its own parent.",
  templateNameLength: "Template name must be between 1 and 80 characters.",
  ticketArchived: "An archived ticket cannot be changed.",
  templateShareTargetMissing:
    "Select at least one department or project to share with.",
  titleLength: "Title must be between 1 and 200 characters.",
  typeUnsupported: "Unsupported work item type.",
} as const;

/** Stable identifier of a reason a work item action is rejected. */
export type WorkItemErrorCode = keyof typeof WORK_ITEM_ERROR_MESSAGES;

/** Thrown when a requested work item does not exist or has been archived. */
export class WorkItemNotFoundError extends Error {
  public constructor() {
    super("The requested work item does not exist.");
  }
}

/** Thrown when a work item action violates hierarchy rules. */
export class WorkItemHierarchyError extends Error {
  public readonly code: WorkItemErrorCode;

  /**
   * Creates a hierarchy error.
   *
   * @param code - Reason the hierarchy is violated.
   */
  public constructor(code: WorkItemErrorCode) {
    super(WORK_ITEM_ERROR_MESSAGES[code]);
    this.code = code;
  }
}

/** Thrown when a work item payload fails validation. */
export class WorkItemValidationError extends Error {
  public readonly code: WorkItemErrorCode;

  /**
   * Creates a validation error.
   *
   * @param code - Reason the payload is rejected.
   */
  public constructor(code: WorkItemErrorCode) {
    super(WORK_ITEM_ERROR_MESSAGES[code]);
    this.code = code;
  }
}

/** Thrown when an actor lacks access to the project associated with a task. */
export class WorkItemAccessDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to access tasks for this project.");
  }
}
