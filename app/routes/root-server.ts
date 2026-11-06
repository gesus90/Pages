import { databaseRequestMiddleware } from "@/app/lib/database-failure.server";
import { requireFinishedSetup } from "@/app/lib/setup-gate.server";

import type { MiddlewareFunction } from "react-router";

/**
 * Runs requests as database request work, answers a refused or unconfirmed
 * database job with `503` (PAGE-197), and keeps every route but the setup
 * wizard closed until the setup finished.
 *
 * @remarks
 * The API's layout around all its routes (PAGE-235); the root route itself
 * belongs to the static app.
 */
export const middleware: MiddlewareFunction[] = [
  ...databaseRequestMiddleware,
  requireFinishedSetup,
];
