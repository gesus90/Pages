import { useEffect } from "react";

import { useToastCenter } from "@/app/components/ui/toast/toast-provider";
import { toastChatKey } from "@/app/components/ui/toast/toast-types";

import type { VirtualChatSelection } from "@/definition/VirtualChat";

/** Suppresses pop-ups for the currently opened chat and honors notification links. */
export function useChatToastSelection(options: {
  readonly selection: VirtualChatSelection | null;
  readonly requested: VirtualChatSelection | undefined;
  readonly select: (selection: VirtualChatSelection) => void;
}): void {
  const { dispatch } = useToastCenter();
  const { select } = options;
  const kind = options.requested?.kind;
  const id = options.requested?.id;
  useEffect(() => {
    if (kind && id) select({ kind, id });
  }, [kind, id, select]);
  const key = options.selection ? toastChatKey(options.selection) : null;
  useEffect(() => {
    const update = (): void => {
      dispatch({
        type: "open-chat",
        key: document.visibilityState === "visible" ? key : null,
      });
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      dispatch({ type: "open-chat", key: null });
    };
  }, [key, dispatch]);
}
