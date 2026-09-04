import { createContext, redirect } from "react-router";

import { getSessionToken } from "@/app/lib/session.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { MiddlewareFunction } from "react-router";
import type { User } from "@/definition/User";

const MAXIMUM_USERNAME_LENGTH = 200;
const MAXIMUM_PASSWORD_LENGTH = 1000;

/** A user placed in the route context after protected-route middleware succeeds. */
export const authenticatedUserContext = createContext<User | null>(null);

/** Values submitted by the login form after server-side validation. */
export interface Credentials {
  readonly username: string;
  readonly password: string;
}

/** Reads the user represented by the request's persisted browser session. */
export async function getAuthenticatedUser(
  request: Request,
): Promise<User | null> {
  const services = await getApplicationServices();

  return services.authService.getAuthenticatedUser(
    await getSessionToken(request),
  );
}

/** Parses a login form while constraining untrusted credentials. */
export function parseCredentials(formData: FormData): Credentials | null {
  const username = formData.get("username");
  const password = formData.get("password");

  if (typeof username !== "string" || typeof password !== "string") {
    return null;
  }

  const trimmedUsername = username.trim();

  if (!trimmedUsername || !password) {
    return null;
  }

  if (
    trimmedUsername.length > MAXIMUM_USERNAME_LENGTH ||
    password.length > MAXIMUM_PASSWORD_LENGTH
  ) {
    return null;
  }

  return { username: trimmedUsername, password };
}

/** Blocks anonymous visitors before protected loaders and actions execute. */
export const requireAuthenticatedUser: MiddlewareFunction = async (
  { context, request },
  next,
) => {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    throw redirect("/login");
  }

  context.set(authenticatedUserContext, user);

  return next();
};
