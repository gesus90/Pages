import type {
  WorkItemLinkType,
  WorkItemPriority,
  WorkItemType,
} from "@/definition/Task";
import type { TemplateScope } from "@/definition/WorkItemTemplate";

/** A person as the ticket API names them: by username, never by internal id. */
export interface McpTicketPerson {
  readonly username: string;
  readonly displayName: string;
}

/** A value of a catalog that the API names by id and name. */
export interface McpTicketNamed {
  readonly id: string;
  readonly name: string;
}

/** A workflow status as the ticket API shows it. */
export interface McpTicketStatus extends McpTicketNamed {
  readonly isDone: boolean;
}

/** A label of the shared catalog. */
export interface McpTicketLabel extends McpTicketNamed {
  readonly color: string;
}

/** Another ticket named inside a ticket: its parent or a link target. */
export interface McpTicketReference {
  readonly key: string;
  readonly title: string;
}

/** A file attached to a ticket. */
export interface McpTicketAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly createdAt: string;
}

/**
 * The answer object "Ticket" of the interface (PAGE-242).
 *
 * @remarks
 * A projection of its own: no GitHub field, no internal column, and nothing
 * of a parent, subtask or linked ticket the account may not see.
 */
export interface McpTicket {
  readonly id: string;
  readonly key: string;
  readonly type: WorkItemType;
  readonly project: McpTicketNamed;
  readonly title: string;
  readonly description: string;
  readonly status: McpTicketStatus;
  readonly priority: WorkItemPriority;
  readonly assignee: McpTicketPerson | null;
  readonly assigneeGroup: McpTicketNamed | null;
  readonly reporter: McpTicketPerson | null;
  readonly department: McpTicketNamed | null;
  readonly parent:
    (McpTicketReference & { readonly type: WorkItemType }) | null;
  readonly milestone: McpTicketNamed | null;
  readonly labels: readonly McpTicketLabel[];
  readonly startAt: string | null;
  readonly dueAt: string | null;
  readonly sortOrder: number;
  readonly archived: boolean;
  readonly progress: {
    readonly subtaskTotal: number;
    readonly subtaskCompleted: number;
    readonly percentage: number;
  };
  readonly subtasks: readonly (McpTicketReference & {
    readonly type: WorkItemType;
    readonly status: McpTicketStatus;
  })[];
  readonly checklist: readonly {
    readonly id: string;
    readonly title: string;
    readonly isDone: boolean;
  }[];
  readonly links: readonly {
    readonly id: string;
    readonly type: WorkItemLinkType;
    readonly direction: "outgoing" | "incoming";
    readonly ticket: McpTicketReference;
  }[];
  readonly attachments: readonly McpTicketAttachment[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

/** One hit of a ticket search. */
export interface McpTicketSummary {
  readonly key: string;
  readonly type: WorkItemType;
  readonly title: string;
  readonly status: McpTicketStatus;
  readonly priority: WorkItemPriority;
  readonly assignee: McpTicketPerson | null;
  readonly assigneeGroup: McpTicketNamed | null;
  readonly parentKey: string | null;
  readonly milestone: McpTicketNamed | null;
  readonly labels: readonly McpTicketLabel[];
  readonly archived: boolean;
}

/** One entry of the activity of a ticket. */
export interface McpTicketHistoryEntry {
  readonly user: McpTicketPerson | null;
  readonly action: string;
  readonly field: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly createdAt: string;
}

/** The choices of a project for creating and changing tickets. */
export interface McpTicketOptions {
  readonly statuses: readonly McpTicketStatus[];
  readonly milestones: readonly McpTicketNamed[];
  readonly labels: readonly McpTicketLabel[];
  readonly templates: readonly (McpTicketNamed & {
    readonly type: WorkItemType;
  })[];
  readonly people: readonly McpTicketPerson[];
  readonly groups: readonly McpTicketNamed[];
  readonly departments: readonly McpTicketNamed[];
}

/** The answer object "Vorlage" of the interface. */
export interface McpTicketTemplate {
  readonly id: string;
  readonly name: string;
  readonly scope: TemplateScope;
  readonly departmentIds: readonly string[];
  readonly projectIds: readonly string[];
  readonly type: WorkItemType;
  readonly title: string;
  readonly description: string;
  readonly priority: WorkItemPriority;
  readonly labelIds: readonly string[];
  readonly checklist: readonly string[];
  readonly canManage: boolean;
}

/** The question an archive or a permanent deletion asks before it changes anything. */
export interface McpTicketConfirmation {
  readonly confirmationRequired: true;
  readonly ticket: McpTicketReference;
  readonly affected: readonly McpTicketReference[];
}
