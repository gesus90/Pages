import { z } from "zod";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { storageResponse } from "@/app/lib/storage-api.server";

import type { Route } from "./+types/storage-access-api";

const grantSchema = z
  .object({
    folderRef: z.string().trim().min(1).max(200).optional(),
    path: z.string().trim().min(1).max(4096).optional(),
    targetKind: z.enum(["role", "department", "group"]),
    targetId: z.string().min(1).max(200),
    enabled: z.boolean(),
  })
  .strict();

/** Reads administrator grant settings or the acting account's Storage history. */
export async function loader({
  context,
  request,
}: Route.LoaderArgs): Promise<Response> {
  const user = context.get(authenticatedUserContext);
  if (!user)
    return storageResponse({ ok: false, error: { code: "forbidden" } }, false);
  const services = await getApplicationServices();
  const access = services.storageAccessService;
  const isSimulation = services.googleDriveFileService.isSimulation;
  return new URL(request.url).searchParams.get("view") === "history"
    ? storageResponse(await access.history(user.id), isSimulation)
    : storageResponse(await access.settings(user.id), isSimulation);
}

/** Grants or revokes one folder right; only an active administrator can configure it. */
export async function action({
  context,
  request,
}: Route.ActionArgs): Promise<Response> {
  const user = context.get(authenticatedUserContext);
  const forbidden = { ok: false, error: { code: "forbidden" } } as const;
  if (!user) return storageResponse(forbidden, false);
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const services = await getApplicationServices();
  const access = services.storageAccessService;
  const granted = await access.settings(user.id);
  if (!granted.ok) return storageResponse(granted, false);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return storageResponse(
      { ok: false, error: { code: "invalid_request" } },
      false,
    );
  }
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success)
    return storageResponse(
      { ok: false, error: { code: "invalid_request" } },
      false,
    );
  const { folderRef, path, targetKind, targetId, enabled } = parsed.data;
  const folder = folderRef
    ? ({ ok: true, value: { entry: { ref: folderRef } } } as const)
    : await services.googleDriveFileService
        .forAccount(user.id)
        .reader.resolvePath(path ?? "");
  if (!folder.ok) return storageResponse(folder, false);
  return storageResponse(
    await access.setGrant(
      user.id,
      { folderRef: folder.value.entry.ref, targetKind, targetId },
      enabled,
    ),
    services.googleDriveFileService.isSimulation,
  );
}
