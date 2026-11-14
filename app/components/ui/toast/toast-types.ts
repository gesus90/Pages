import type { VirtualChatSelection } from "@/definition/VirtualChat";

/** A keyboard-accessible follow-up to a notice. Handle asynchronous failures at the call site. */
export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

interface ToastContent {
  readonly message: string;
  readonly description?: string;
  readonly action?: ToastAction;
}

/** A standard notice, or a chat notice grouped by the page's conversation selection. */
export type ToastInput =
  | (ToastContent & { readonly type: "success" | "info" | "warning" | "error" })
  | (ToastContent & {
      readonly type: "chat";
      readonly chat: VirtualChatSelection;
      readonly count: number;
      readonly avatarImageUrl?: string | null;
    });

/** A notice keeps its identity and position when its lifetime is restarted. */
export type ToastMessage = ToastInput & {
  readonly id: number;
  readonly revision: number;
};

/** Timed notices pause on interaction; errors require explicit dismissal. */
export const TOAST_DURATIONS = {
  success: 4000,
  info: 6000,
  warning: 8000,
  error: null,
  chat: 8000,
} as const;

/** Shared with the entry and exit animations in toast.module.css. */
export const TOAST_EXIT_MILLISECONDS = 220;

/** Stable key of a chat, also used for suppressing its opened conversation. */
export function toastChatKey(chat: VirtualChatSelection): string {
  return `${chat.kind}:${chat.id}`;
}
