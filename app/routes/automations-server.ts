import { data } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AutomationError } from "@/backend/error/AutomationError";
import { logCaughtError } from "@/backend/logging/Logger";
import { AUTOMATION_PAGE_INTENTS } from "@/definition/AutomationPage";

import type { ApplicationServices } from "@/app/lib/services.server";
import type {
  AutomationPageActionData,
  AutomationPageData,
  AutomationPageIntent,
} from "@/definition/AutomationPage";
import type { User } from "@/definition/User";
import type { Route } from "./+types/automations-server";

/** Automations and runs the page shows at most. */
const PAGE_LIMIT = 100;
const PAGE_ROUNDS = 5;

async function allAutomations(
  services: ApplicationServices,
  user: User,
): Promise<AutomationPageData["automations"]> {
  const items: AutomationPageData["automations"][number][] = [];
  let cursor: string | null = null;
  for (let round = 0; round < PAGE_ROUNDS; round += 1) {
    const page = await services.automationService.list(user.id, {
      limit: PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return items;
}

async function displayNames(
  services: ApplicationServices,
  options: AutomationPageData["options"],
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  const choices = [
    ...options.agents,
    ...options.plans,
    ...options.projects,
    ...options.projects.flatMap((project) => project.statuses),
    ...options.plans.flatMap((plan) => plan.steps),
    ...options.sharing.projects,
    ...options.sharing.groups,
    ...options.workspaces,
    ...options.interpreterProfiles,
  ];
  for (const choice of choices) names[choice.id] = choice.name;
  const sharing = await services.automationService.sharingNames();
  for (const [id, name] of sharing) names[id] ??= name;
  return names;
}

/**
 * Loads the automations of the signed-in account with their runs and
 * options (PAGE-297); the workspace frame applies the authentication.
 */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<AutomationPageData> {
  const user = context.get(authenticatedUserContext);
  if (!user) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  const [automations, history, options] = await Promise.all([
    allAutomations(services, user),
    services.automationService.history(user.id, { limit: PAGE_LIMIT }),
    services.automationService.options(user.id),
  ]);
  return {
    automations,
    history: history.items,
    options,
    names: await displayNames(services, options),
    readAt: new Date().toISOString(),
  };
}

function readIntent(
  value: FormDataEntryValue | null,
): AutomationPageIntent | null {
  return AUTOMATION_PAGE_INTENTS.find((intent) => intent === value) ?? null;
}

function readPayload(formData: FormData): unknown {
  const value = formData.get("payload");
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    throw new AutomationError("invalid_request", { reason: "validation" });
  }
}

async function runIntent(
  services: ApplicationServices,
  user: User,
  intent: AutomationPageIntent,
  payload: unknown,
): Promise<AutomationPageActionData> {
  const automations = services.automationService;
  switch (intent) {
    case "create":
      return {
        ok: true,
        intent,
        automation: await automations.create(user.id, payload),
      };
    case "update":
      return {
        ok: true,
        intent,
        automation: await automations.update(user.id, payload),
      };
    case "setActive":
      return {
        ok: true,
        intent,
        automation: await automations.setActive(user.id, payload),
      };
    case "run": {
      const receipt = await automations.runNow(user.id, payload);
      return {
        ok: true,
        intent,
        runId: receipt.runId,
        runStatus: receipt.status === "queued" ? "queued" : "accepted",
      };
    }
    case "delete": {
      const result = await automations.delete(user.id, payload);
      return { ok: true, intent, deletedId: result.automationId };
    }
  }
}

/**
 * Creates, changes, switches, runs and deletes automations of the page.
 *
 * @remarks
 * The page sends the operation's input as JSON in `payload`, with its own
 * operation ID; the same automation service as Pica, the agent tools and
 * the HTTP API checks every right. The confirmation dialog of the page is
 * the explicit confirmation of a deletion.
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<
  ReturnType<typeof data<AutomationPageActionData>>
> {
  const user = context.get(authenticatedUserContext);
  if (!user) throw new Response("Forbidden", { status: 403 });
  const formData = await request.formData();
  const intent = readIntent(formData.get("intent"));
  if (!intent) throw new Response("Bad Request", { status: 400 });
  const services = await getApplicationServices();
  try {
    return data(await runIntent(services, user, intent, readPayload(formData)));
  } catch (error: unknown) {
    if (!(error instanceof AutomationError)) throw error;
    logCaughtError("automations_page", error);
    return data<AutomationPageActionData>(
      {
        ok: false,
        intent,
        error: {
          code: error.code,
          reason: error.reason,
          problems: error.problems,
          currentRevision: error.currentRevision,
        },
      },
      { status: error.status },
    );
  }
}
