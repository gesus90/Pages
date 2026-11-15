import { notePicaNativeTool } from "./PicaAcpNativeToolRecord";
import { PicaAcpUpdates } from "./PicaAcpUpdates";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { PicaAcpAnswerOutput } from "./PicaAcpAnswerOutput";
import type { PicaAcpCredential } from "./PicaAcpCredential";
import type { PicaAcpJobDependencies } from "./PicaAcpJobDependencies";
import type { PicaAcpJobSpecification } from "./PicaAcpJobSpecification";
import type { PicaAcpJournal } from "./PicaAcpJournal";
import type { PicaAcpPrompt } from "./PicaAcpPrompt";
import type { PicaAcpThreadWatch } from "./PicaAcpThreadWatch";
import type { PicaAcpUsage } from "./PicaAcpUsage";

/** What the update stream of a Pica job writes to. */
export interface PicaAcpJobUpdateTarget {
  readonly specification: PicaAcpJobSpecification;
  readonly dependencies: Pick<PicaAcpJobDependencies, "liveAnswer" | "recipes">;
  readonly credential: PicaAcpCredential;
  readonly prompt: PicaAcpPrompt;
  readonly journal: PicaAcpJournal;
  readonly usage: PicaAcpUsage;
  readonly thread: PicaAcpThreadWatch;
  readonly answerOutput: PicaAcpAnswerOutput;
  readonly notedNativeCalls: Set<string>;
  readonly context: () => RuntimeExecutionContext;
  readonly onSteering: (canSteer: boolean) => void;
  readonly onPromptEnded: (turn: number) => void;
}

/** Builds the update listener for one Pica ACP job. */
export function createPicaAcpUpdates(
  target: PicaAcpJobUpdateTarget,
): PicaAcpUpdates {
  const { specification, dependencies, credential } = target;
  return new PicaAcpUpdates(
    {
      picaCodex: {
        catalog: () => credential.catalog(target.context().signal),
        capture: () => credential.capture(target.context()),
      },
      ...(specification.agent.connection.provider === "claude_code"
        ? { picaHelper: () => credential.helperPath() }
        : {}),
      steering: (canSteer, capabilities) => {
        target.prompt.negotiated(capabilities);
        target.onSteering(canSteer);
        target.journal.note({ kind: "capabilities", canSteer });
      },
      text: (turn, isReset, delta) => target.journal.text(turn, isReset, delta),
      thought: (turn, delta) => dependencies.liveAnswer?.thought(turn, delta),
      context: (context, cost) => target.usage.recordContext(context, cost),
      compaction: (compaction) =>
        target.journal.note({ kind: "compaction", ...compaction }),
      promptEnded: (turn, tokens) => {
        target.onPromptEnded(turn);
        if (credential.boundTurn === turn) credential.revoke();
        target.usage.recordTokens(turn, tokens);
      },
      threadStatus: (isActive) => target.thread.observe(isActive),
      content: (turn, block) => target.answerOutput.take(turn, block),
      closed: () => target.thread.close(),
      // Host tools of an agent employee show in the chat with input and result (PAGE-303).
      ...(specification.run.options.access === "yolo"
        ? {
            nativeTool: (event) => {
              target.journal.note({ kind: "tool", ...event });
              notePicaNativeTool(
                event,
                target.notedNativeCalls,
                dependencies.recipes,
              );
            },
          }
        : {}),
    },
    specification.run.runner,
  );
}
