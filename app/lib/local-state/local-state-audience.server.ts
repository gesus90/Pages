import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";
import type { LocalStateAudience } from "./local-state-audience";

/**
 * The account's authorization fingerprint, as the page shell and `/account-version` report it.
 *
 * @param services - Initialized server-side services.
 * @param userId - The signed-in account.
 */
export async function readAuthorizationVersion(
  services: ApplicationServices,
  userId: string,
): Promise<string> {
  const [version, pica] = await Promise.all([
    services.administrationService.version(userId),
    services.picaSettingsService.read(),
  ]);
  return `${version}:pica:${pica.revision}`;
}

/**
 * Names whom a route answer is for, so the browser keeps it only for that account and those rights.
 *
 * @param services - Initialized server-side services.
 * @param actor - The signed-in account the answer was checked for.
 */
export async function readLocalStateAudience(
  services: ApplicationServices,
  actor: User,
): Promise<LocalStateAudience> {
  return {
    userId: actor.id,
    authorizationVersion: await readAuthorizationVersion(services, actor.id),
  };
}
