import { LocalOwnerSession } from "@/backend/agents/local/LocalOwnerSession";

import {
  DIRECTORY,
  doubles,
  launchOf,
  stub,
} from "./local-owner-session-fixture";

import type {
  LocalOwnerManifest,
  LocalSessionLaunch,
} from "@/backend/agents/local/LocalSessionContracts";

/** An owner over the doubles. */
export function newOwner(
  launch: LocalSessionLaunch = launchOf(),
): LocalOwnerSession {
  return new LocalOwnerSession(
    stub<LocalOwnerManifest>({ directory: DIRECTORY, launch }),
    stub({ append: doubles.append }),
    stub({
      database: {},
      runs: { find: doubles.findRun },
      preparation: { prepare: doubles.prepare },
      execution: { open: doubles.open },
    }),
  );
}
