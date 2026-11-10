import { LocalSessions } from "@/backend/agents/local/LocalSessions";

import {
  CONFIG_PATH,
  DATA_DIRECTORY,
  entryOf,
  mocks,
  resources,
  stub,
  supervisor,
} from "./local-sessions-fixture";

import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";

/** Builds the class under test over the doubles. */
export function createSessions(): LocalSessions {
  return new LocalSessions({
    database: stub("database"),
    configPath: CONFIG_PATH,
    dataDirectory: DATA_DIRECTORY,
    tokenKey: Buffer.from("token-key"),
    resources: stub(resources),
    tools: stub({ supervisor }),
  });
}

/** Proves one stored owner so the instance treats it as live. */
export async function adopt(
  sessions: LocalSessions,
  entry: LocalSessionEntry = entryOf(),
): Promise<void> {
  mocks.owners.list.mockResolvedValue([entry]);
  await sessions.discover();
}
