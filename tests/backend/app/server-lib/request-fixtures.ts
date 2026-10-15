import { sessionCookie } from "@/app/lib/session.server";

import type { User } from "@/definition/User";

/** The origin every synthetic request is addressed to. */
export const SYNTHETIC_ORIGIN = "http://pages.invalid";

/** An active employee without a pending password change. */
export const EMPLOYEE: User = {
  id: "employee",
  username: "employee",
  displayName: "Employee",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

/** Builds a user that has to replace a temporary password first. */
export function mustChangePasswordUser(): User {
  return { ...EMPLOYEE, mustChangePassword: true };
}

/** The `Cookie` header value a browser sends for a stored session token. */
export async function sessionCookieHeader(token: string): Promise<string> {
  const serialized = await sessionCookie.serialize(token);

  return serialized.split(";")[0] ?? "";
}

/**
 * Awaits work that has to reject with a response, as loaders and actions do
 * for redirects and refusals.
 *
 * @param work - Promise of the loader, action or middleware.
 * @returns The thrown response.
 */
export async function thrownResponse(
  work: Promise<unknown>,
): Promise<Response> {
  try {
    await work;
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the work to throw a response.");
}
