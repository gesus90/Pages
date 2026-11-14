import { toastChatKey } from "./toast-types";

import type { ToastInput, ToastMessage } from "./toast-types";

/** Document-scoped pop-ups and the bell's retained notices. Nothing is stored across accounts. */
export interface ToastState {
  readonly messages: readonly ToastMessage[];
  readonly inbox: readonly ToastMessage[];
  readonly openedChat: string | null;
  readonly serial: number;
}

/** Changes shared by the toaster, bell and opened chat. */
export type ToastCommand =
  | { readonly type: "receive"; readonly notice: ToastInput }
  | { readonly type: "dismiss"; readonly id: number }
  | { readonly type: "forget"; readonly id: number }
  | { readonly type: "open-chat"; readonly key: string | null };

/** An empty document has no notifications, including during server rendering. */
export const EMPTY_TOAST_STATE: ToastState = {
  messages: [],
  inbox: [],
  openedChat: null,
  serial: 0,
};

function sameNotice(first: ToastInput, second: ToastInput): boolean {
  if (first.type === "chat" && second.type === "chat")
    return toastChatKey(first.chat) === toastChatKey(second.chat);
  return (
    first.type === second.type &&
    first.message === second.message &&
    first.description === second.description &&
    first.action?.label === second.action?.label
  );
}

function insertNotice(
  entries: readonly ToastMessage[],
  notice: ToastMessage,
): readonly ToastMessage[] {
  const previous = entries.find((entry) => sameNotice(entry, notice));
  if (!previous) return [notice, ...entries];
  const updated: ToastMessage = {
    ...notice,
    id: previous.id,
    revision: previous.revision + 1,
  };
  if (updated.type === "chat" && previous.type === "chat")
    return entries.map((entry) =>
      entry.id === previous.id
        ? { ...updated, count: previous.count + updated.count }
        : entry,
    );
  return entries.map((entry) => (entry.id === previous.id ? updated : entry));
}

/** Applies notices atomically, retaining chat and error history after pop-ups disappear. */
export function reduceToasts(
  state: ToastState,
  command: ToastCommand,
): ToastState {
  if (command.type === "dismiss") {
    const notice = state.inbox.find((entry) => entry.id === command.id);
    return {
      ...state,
      messages: state.messages.filter(
        (entry) =>
          entry.id !== command.id && (!notice || !sameNotice(entry, notice)),
      ),
    };
  }
  if (command.type === "forget")
    return {
      ...state,
      inbox: state.inbox.filter((entry) => entry.id !== command.id),
    };
  if (command.type === "open-chat")
    return {
      ...state,
      openedChat: command.key,
      messages: state.messages.filter(
        (entry) =>
          entry.type !== "chat" || toastChatKey(entry.chat) !== command.key,
      ),
    };
  const notice: ToastMessage = {
    ...command.notice,
    id: state.serial,
    revision: 0,
  };
  const isOpened =
    notice.type === "chat" && toastChatKey(notice.chat) === state.openedChat;
  const inbox =
    notice.type === "error" || notice.type === "chat"
      ? insertNotice(state.inbox, notice).slice(0, 100)
      : state.inbox;
  return {
    ...state,
    serial: state.serial + 1,
    messages: isOpened
      ? state.messages
      : insertNotice(state.messages, notice).slice(0, 3),
    inbox,
  };
}
