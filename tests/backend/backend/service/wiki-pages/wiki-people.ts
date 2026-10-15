import { CAPABILITY } from "@/definition/Authorization";

import { WikiWorld } from "./wiki-world";

/**
 * Builds a wiki world with the accounts most wiki tests need.
 *
 * @returns A world with `owner`, `other`, `admin`, `manager` and `reader`.
 *
 * @remarks
 * `owner` and `other` write in project `alpha`; `manager` also manages
 * projects; `admin` acts in the admin mode and reads every project; `reader`
 * lacks the capability write.
 */
export function createPeopleWorld(): WikiWorld {
  const world = new WikiWorld();
  world.addPerson("owner", { projects: ["alpha"], departments: ["sales"] });
  world.addPerson("other", { projects: ["alpha"], departments: ["sales"] });
  world.addPerson("admin", {
    capabilities: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
    isAdmin: true,
    projects: ["alpha", "beta"],
  });
  world.addPerson("manager", {
    capabilities: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
    projects: ["alpha"],
  });
  world.addPerson("reader", {
    capabilities: [],
    projects: ["alpha"],
    departments: ["sales"],
  });
  return world;
}
