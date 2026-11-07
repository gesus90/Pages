import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";

import { McpTicketError } from "./McpTicketError";

import type { Label } from "@/definition/Task";
import type {
  TemplateDetailsInput,
  WorkItemTemplateView,
} from "@/definition/WorkItemTemplate";
import type { McpTicketLabel, McpTicketTemplate } from "./McpTicketContract";
import type { McpTicketContext } from "./McpTicketContext";
import type {
  McpTicketLabelCreateRequest,
  McpTicketLabelUpdateRequest,
  McpTicketTemplateCreateRequest,
  McpTicketTemplateUpdateRequest,
} from "./McpTicketRequest";

/** The question a label deletion asks before it changes anything. */
export interface McpTicketLabelConfirmation {
  readonly confirmationRequired: true;
  readonly label: McpTicketLabel;
  readonly usageCount: number;
}

function labelOf(label: Label): McpTicketLabel {
  return { id: label.id, name: label.name, color: label.color };
}

function templateOf(template: WorkItemTemplateView): McpTicketTemplate {
  return {
    id: template.id,
    name: template.name,
    scope: template.scope,
    departmentIds: template.departmentIds,
    projectIds: template.projectIds,
    type: template.type,
    title: template.title,
    description: template.description,
    priority: template.priority,
    labelIds: template.labelIds,
    checklist: template.checklist,
    canManage: template.canManage,
  };
}

/**
 * Rejects share targets that the chosen scope does not use.
 *
 * @throws {McpTicketError} `invalid_request` for departments outside the
 * scope `departments` or projects outside the scope `projects`.
 */
function requireMatchingTargets(request: {
  readonly scope?: string;
  readonly departmentIds?: readonly string[];
  readonly projectIds?: readonly string[];
}): void {
  const hasDepartments = (request.departmentIds ?? []).length > 0;
  const hasProjects = (request.projectIds ?? []).length > 0;
  if (
    (hasDepartments && request.scope !== TEMPLATE_SCOPE.DEPARTMENTS) ||
    (hasProjects && request.scope !== TEMPLATE_SCOPE.PROJECTS)
  )
    throw new McpTicketError("invalid_request");
}

/** The shared label catalog and the ticket templates (PAGE-242, interface 12–13). */
export class McpTicketCatalogService {
  /**
   * Adds a label to the shared catalog.
   *
   * @param context - The request.
   * @param request - Name and color of the label.
   */
  public async createLabel(
    context: McpTicketContext,
    request: McpTicketLabelCreateRequest,
  ): Promise<McpTicketLabel> {
    return labelOf(
      await context.services.tasks.createLabel(context.actor, request),
    );
  }

  /**
   * Renames or recolors a label.
   *
   * @param context - The request.
   * @param labelId - The label.
   * @param request - The new name, color or both.
   */
  public async updateLabel(
    context: McpTicketContext,
    labelId: string,
    request: McpTicketLabelUpdateRequest,
  ): Promise<McpTicketLabel> {
    const label = await this.requireLabel(context, labelId);
    return labelOf(
      await context.services.tasks.updateLabel(context.actor, label.id, {
        name: request.name ?? label.name,
        color: request.color ?? label.color,
      }),
    );
  }

  /**
   * Deletes a label after the client confirmed how many tickets carry it.
   *
   * @param context - The request.
   * @param labelId - The label.
   * @param isConfirmed - Whether the body says `confirmed: true`.
   * @returns The question with the number of tickets, or the deletion.
   * @throws {McpTicketError} `forbidden` without the write right, which the
   * deletion needs.
   */
  public async deleteLabel(
    context: McpTicketContext,
    labelId: string,
    isConfirmed: boolean,
  ): Promise<McpTicketLabelConfirmation | { readonly deleted: true }> {
    const { actor, services } = context;
    const label = await this.requireLabel(context, labelId);
    if (!isConfirmed) {
      const { canWrite } = await services.tasks.actionPermissions(actor);
      if (!canWrite) throw new McpTicketError("forbidden");
      const usage = await services.tasks.countLabelUsage(actor);
      return {
        confirmationRequired: true,
        label: labelOf(label),
        usageCount: usage.get(label.id) ?? 0,
      };
    }
    await services.tasks.deleteLabel(actor, label.id);
    return { deleted: true };
  }

  /**
   * Reads a template the account may see.
   *
   * @param context - The request.
   * @param templateId - The template.
   */
  public async readTemplate(
    context: McpTicketContext,
    templateId: string,
  ): Promise<McpTicketTemplate> {
    return templateOf(await this.requireTemplate(context, templateId));
  }

  /**
   * Saves the content of a ticket as a new template of the account.
   *
   * @param context - The request.
   * @param request - The ticket, the name and the audience.
   */
  public async saveTemplate(
    context: McpTicketContext,
    request: McpTicketTemplateCreateRequest,
  ): Promise<McpTicketTemplate> {
    requireMatchingTargets(request);
    const ticket = await context.ticket(request.ticket);
    const templateId = await context.services.templates.saveFromTicket(
      context.actor,
      ticket.id,
      {
        name: request.name,
        scope: request.scope,
        departmentIds: request.departmentIds ?? [],
        projectIds: request.projectIds ?? [],
      },
    );
    return this.readTemplate(context, templateId);
  }

  /**
   * Renames a template or changes whom it is shared with.
   *
   * @param context - The request.
   * @param templateId - A template the account may manage.
   * @param request - The fields to change; the others keep their values.
   */
  public async updateTemplate(
    context: McpTicketContext,
    templateId: string,
    request: McpTicketTemplateUpdateRequest,
  ): Promise<McpTicketTemplate> {
    const template = await this.requireTemplate(context, templateId);
    const scope = request.scope ?? template.scope;
    requireMatchingTargets({ ...request, scope });
    const details: TemplateDetailsInput = {
      name: request.name ?? template.name,
      scope,
      departmentIds: request.departmentIds ?? template.departmentIds,
      projectIds: request.projectIds ?? template.projectIds,
    };
    await context.services.templates.update(
      context.actor,
      template.id,
      details,
    );
    return this.readTemplate(context, template.id);
  }

  /**
   * Deletes a template; its owner and an administrator may.
   *
   * @param context - The request.
   * @param templateId - The template.
   */
  public async deleteTemplate(
    context: McpTicketContext,
    templateId: string,
  ): Promise<void> {
    await context.services.templates.delete(context.actor, templateId);
  }

  private async requireLabel(
    context: McpTicketContext,
    labelId: string,
  ): Promise<Label> {
    const label = (await context.services.tasks.findLabels()).find(
      (candidate) => candidate.id === labelId,
    );
    if (!label) throw new McpTicketError("not_found");
    return label;
  }

  private async requireTemplate(
    context: McpTicketContext,
    templateId: string,
  ): Promise<WorkItemTemplateView> {
    const template = (
      await context.services.templates.findVisible(context.actor)
    ).find((candidate) => candidate.id === templateId);
    if (!template) throw new McpTicketError("not_found");
    return template;
  }
}
