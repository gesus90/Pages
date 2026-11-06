import { sendToBackend } from "@/app/lib/backend-request";

import type {
  ClientActionFunctionArgs,
  ClientLoaderFunctionArgs,
} from "react-router";

/**
 * Loads a server resource of the static app from the API (PAGE-235).
 *
 * @remarks
 * Every server resource of `app/routes.ts` uses this module in the static
 * app, so components keep loading resources with fetchers and forms.
 */
export async function clientLoader({
  request,
}: ClientLoaderFunctionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Sends a change of a server resource to the API, see {@link clientLoader}. */
export async function clientAction({
  request,
}: ClientActionFunctionArgs): Promise<unknown> {
  return sendToBackend(request);
}
