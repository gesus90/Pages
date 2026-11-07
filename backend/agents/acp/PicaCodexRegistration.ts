import { PICA_CODEX_METHOD, PICA_CODEX_REQUEST } from "./PicaCodexProtocol";

import type { client as acpClient } from "@agentclientprotocol/sdk";
import type { PicaCodexRequests } from "./PicaCodexRequests";

/** Adds the private native-tool methods only to a Pica Codex client. */
export function registerPicaCodexRequests(
  client: ReturnType<typeof acpClient>,
  native: PicaCodexRequests,
): void {
  client
    .onRequest(
      PICA_CODEX_METHOD.catalog,
      PICA_CODEX_REQUEST.catalog,
      async () => {
        const tools = await native.catalog();
        return { tools, context: native.catalogContext() };
      },
    )
    .onRequest(
      PICA_CODEX_METHOD.bindThread,
      PICA_CODEX_REQUEST.policyThread,
      ({ params }) => ({
        accepted: native.bindThread(params.threadId, params.context),
      }),
    )
    .onRequest(
      PICA_CODEX_METHOD.prepare,
      PICA_CODEX_REQUEST.thread,
      ({ params }) => native.prepareTurn(params.threadId),
    )
    .onRequest(PICA_CODEX_METHOD.ready, PICA_CODEX_REQUEST.ready, ({ params }) =>
      native.admitReady(params) ? { ...params, accepted: true } : { accepted: false },
    )
    .onRequest(PICA_CODEX_METHOD.revoke, PICA_CODEX_REQUEST.ready, async ({ params }) =>
      (await native.revokeOperation(params)) ? { ...params, accepted: true } : { accepted: false },
    )
    .onRequest(
      PICA_CODEX_METHOD.cancelPrepare,
      PICA_CODEX_REQUEST.prepareCancel,
      async ({ params }) => ({
        cancelled: await native.cancelPrepare(params.threadId, params.nonce),
      }),
    )
    .onRequest(
      PICA_CODEX_METHOD.bindTurn,
      PICA_CODEX_REQUEST.turn,
      ({ params }) => ({
        accepted: native.bindTurn(params.threadId, params.turnId),
      }),
    )
    .onRequest(
      PICA_CODEX_METHOD.endTurn,
      PICA_CODEX_REQUEST.turn,
      async ({ params }) => {
        await native.endTurn(params.threadId, params.turnId);
        return { ended: true };
      },
    )
    .onRequest(
      PICA_CODEX_METHOD.closeThread,
      PICA_CODEX_REQUEST.thread,
      async ({ params }) => {
        await native.closeThread(params.threadId);
        return { closed: true };
      },
    )
    .onRequest(
      PICA_CODEX_METHOD.dispatch,
      PICA_CODEX_REQUEST.call,
      ({ params, signal }) => native.dispatch(params, signal),
    )
    .onRequest(
      PICA_CODEX_METHOD.chunk,
      PICA_CODEX_REQUEST.chunk,
      ({ params }) => native.chunk(params),
    );
}
