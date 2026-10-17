import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  backgroundSaveCoordinator,
  SupersededBackgroundSaveError,
} from "@/backend/service/BackgroundSaveCoordinator";
import { draftOrderSchema } from "@/definition/BackgroundSave";
import { logCaughtError } from "@/backend/logging/Logger";

import type { RouterContextProvider } from "react-router";
import type { z } from "zod";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";
import type { BackgroundSaveOrder } from "@/backend/service/BackgroundSaveCoordinator";

/** Validates the JSON boundary without bypassing route authentication. */
export async function readDraftRequest<T>(
  args: {
    readonly request: Request;
    readonly context: Readonly<RouterContextProvider>;
  },
  schema: z.ZodType<T>,
): Promise<{
  actor: User;
  services: ApplicationServices;
  base: T;
  draft: T;
  streamId: string;
  sequence: number;
}> {
  if (args.request.method !== "POST") {
    throw Response.json(
      { ok: false, error: "invalidInput" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  const actor = args.context.get(authenticatedUserContext);
  const origin = args.request.headers.get("Origin");
  if (
    !actor ||
    (origin !== null && origin !== new URL(args.request.url).origin)
  ) {
    throw Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let payload: unknown;
  try {
    payload = await args.request.json();
  } catch (error: unknown) {
    logCaughtError("draft_request", error);

    if (!(error instanceof SyntaxError)) throw error;
    throw Response.json({ ok: false, error: "invalidInput" }, { status: 400 });
  }
  const parsed = draftOrderSchema
    .extend({ base: schema, draft: schema })
    .safeParse(payload);
  if (!parsed.success) {
    throw Response.json({ ok: false, error: "invalidInput" }, { status: 400 });
  }
  return { ...parsed.data, actor, services: await getApplicationServices() };
}

/** Keeps stale attempts from reaching a service after a newer attempt finished. */
export async function runDraftWrite(
  order: BackgroundSaveOrder,
  work: () => Promise<Response>,
): Promise<Response> {
  try {
    return await backgroundSaveCoordinator.run(order, work);
  } catch (error: unknown) {
    logCaughtError("draft_request", error);

    if (error instanceof SupersededBackgroundSaveError) {
      return Response.json({ ok: false, error: "superseded" }, { status: 409 });
    }
    throw error;
  }
}
