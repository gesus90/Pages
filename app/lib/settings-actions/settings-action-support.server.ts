import type { data } from "react-router";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";

/** Outcome of a password change attempt reported to the visitor. */
export type PasswordChangeOutcome =
  | "success"
  | "invalidInput"
  | "invalidCurrent"
  | "mismatch"
  | "tooShort"
  | "unchanged";

/** Error codes when updating the personal profile. */
export type ProfileUpdateErrorCode =
  | "invalidInput"
  | "invalidAvatar"
  | "usernameTaken"
  | "emailTaken"
  | "forbidden"
  | "lastAdministrator"
  | "general";

/** Error codes when a user replaces only their own avatar image. */
type AvatarUpdateErrorCode = "invalidInput" | "invalidAvatar" | "general";

/** What the settings screen receives after a submitted form. */
export type SettingsActionData =
  | {
      readonly intent: "change-password";
      readonly outcome: PasswordChangeOutcome;
    }
  | {
      readonly intent: "update-profile";
      readonly ok: true;
    }
  | {
      readonly intent: "update-profile";
      readonly ok: false;
      readonly error: ProfileUpdateErrorCode;
    }
  | {
      readonly intent: "update-avatar";
      readonly ok: true;
    }
  | {
      readonly intent: "update-avatar";
      readonly ok: false;
      readonly error: AvatarUpdateErrorCode;
    }
  | {
      readonly intent: "update-port";
      readonly ok: true;
      readonly port: number;
    }
  | {
      readonly intent: "update-port";
      readonly ok: false;
      readonly error: "invalidPort" | "general";
    }
  | { readonly intent: "revoke-other-sessions" }
  | { readonly intent: "revoke-session" };

/** The response a settings action returns; saving settings answers `null`. */
export type SettingsActionResult = ReturnType<
  typeof data<SettingsActionData>
> | null;

/** Everything a settings action handler needs from the request. */
export interface SettingsActionContext {
  readonly user: User;
  readonly request: Request;
  readonly formData: FormData;
  readonly services: ApplicationServices;
}

/** Handles one settings action. */
export type SettingsActionHandler = (
  context: SettingsActionContext,
) => Promise<SettingsActionResult>;

/** Rejects a request that no honest client sends. */
export function badRequest(): Response {
  return new Response("Bad Request", { status: 400 });
}

/** Rejects a request the signed-in user may not make. */
export function forbidden(): Response {
  return new Response("Forbidden", { status: 403 });
}
