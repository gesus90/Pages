import { useLoaderData, useSearchParams } from "react-router";

import { CHAT_PAGE_ENDPOINT, isChatDirectory } from "@/app/lib/chat-directory";
import { ChatPage } from "@/app/components/chat-page/chat-page";
import { sendToBackend } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type {
  VirtualChatDirectory,
  VirtualChatSelection,
} from "@/definition/VirtualChat";
import type { Route } from "./+types/chat-page";

export { CHAT_PAGE_ENDPOINT, isChatDirectory } from "@/app/lib/chat-directory";

/** The changes after which the page keeps its data. */
const QUIET_INTENTS: readonly string[] = [
  "history",
  "card-state",
  "split-width",
];

/**
 * Reads the participants, the dialog choices and the histories of the chat
 * page (PAGE-266) from its endpoint.
 */
export function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<VirtualChatDirectory> {
  return readRouteData({
    endpoint: CHAT_PAGE_ENDPOINT,
    signal: request.signal,
    isPayload: isChatDirectory,
  });
}

/**
 * Loading older messages changes nothing, so the page keeps its data
 * (PAGE-275); a card state and the split width show at once (PAGE-298).
 */
export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  const intent = formData?.get("intent");
  return typeof intent === "string" && QUIET_INTENTS.includes(intent)
    ? false
    : defaultShouldRevalidate;
}

/** Sends a change of the chat page to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders the chat page with people, agents and groups. */
export default function ChatPageRoute(): React.ReactElement {
  const [params] = useSearchParams();
  const kind = params.get("kind");
  const id = params.get("id");
  const requestedSelection: VirtualChatSelection | undefined =
    (kind === "group" || kind === "participant") && id
      ? { kind, id }
      : undefined;
  return (
    <ChatPage
      directory={useLoaderData<typeof clientLoader>()}
      requestedSelection={requestedSelection}
    />
  );
}
