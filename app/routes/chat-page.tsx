import { useLoaderData } from "react-router";

import { ChatPage } from "@/app/components/chat-page/chat-page";
import { sendToBackend } from "@/app/lib/backend-request";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { ShouldRevalidateFunctionArgs } from "react-router";
import type { VirtualChatDirectory } from "@/definition/VirtualChat";
import type { Route } from "./+types/chat-page";

/** The endpoint of the chat page; it reads with the rights of the signed-in account. */
export const CHAT_PAGE_ENDPOINT = "/chat-page-api/page";

/** Recognizes the answer of the chat page endpoint. */
export function isChatDirectory(value: unknown): value is VirtualChatDirectory {
  return (
    typeof value === "object" &&
    value !== null &&
    "participants" in value &&
    Array.isArray(value.participants) &&
    "contactChoices" in value &&
    Array.isArray(value.contactChoices) &&
    "histories" in value &&
    typeof value.histories === "object"
  );
}

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

/** Loading older messages changes nothing, so the page keeps its data (PAGE-275). */
export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  return formData?.get("intent") === "history"
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
  return <ChatPage directory={useLoaderData<typeof clientLoader>()} />;
}
