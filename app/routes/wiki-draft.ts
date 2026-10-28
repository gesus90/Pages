import {
  readDraftRequest,
  runDraftWrite,
} from "@/app/lib/drafts/draft-request.server";
import { toWikiActionError } from "@/app/lib/wiki-actions/wiki-action-support.server";
import { wikiSaveContentSchema } from "@/definition/BackgroundSave";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/wiki-draft";

/** Saves revision-controlled wiki fields through the normal authorization service. */
export async function action(args: Route.ActionArgs): Promise<Response> {
  const { actor, services, base, draft, streamId, sequence } =
    await readDraftRequest(args, wikiSaveContentSchema);
  return runDraftWrite(
    {
      actorId: actor.id,
      objectId: `wiki:${args.params.pageId}`,
      streamId,
      sequence,
    },
    async () => {
      try {
        const page = await services.wikiService.update(
          actor,
          args.params.pageId,
          {
            title: draft.title,
            content: draft.content,
            icon: draft.icon,
            expectedRevision: base.revision,
          },
        );
        return Response.json({
          ok: true,
          saved: wikiSaveContentSchema.parse(page),
        });
      } catch (error: unknown) {
        logCaughtError("wiki_draft", error);

        const failure = toWikiActionError(error);
        return Response.json(failure.data, { ...failure.init });
      }
    },
  );
}
