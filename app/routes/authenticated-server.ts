import { requireAuthenticatedUser } from "@/app/lib/auth.server";

import type { MiddlewareFunction } from "react-router";

/** Applies persistent-session authentication to all nested workspace routes. */
export const middleware: MiddlewareFunction[] = [requireAuthenticatedUser];
