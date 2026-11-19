import { Phone, Video } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { showToast } from "@/app/components/ui/toast";
import { USER_AVATAR_TYPE } from "@/definition/User";

import { ChatCallBadge } from "./chat-call-badge";
import { useCallAudio } from "./use-call-audio";
import { useChatCalls } from "./use-chat-calls";

import type { ChatCallView } from "@/definition/ChatCall";

/**
 * The room the notice takes at the top right, so the pop-ups of new messages
 * below it stay readable: 132 px height and a gap of 16 px.
 */
const NOTICE_OFFSET = "148px";

const NOTICE_BUTTON =
  "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none";

function openChatAddress(call: ChatCallView): string {
  const query = new URLSearchParams({
    kind: "participant",
    id: call.participant.id,
  });
  return `/chat?${query.toString()}`;
}

function IncomingCallCard({
  call,
}: {
  readonly call: ChatCallView;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { respond } = useChatCalls();
  const callAudio = useCallAudio();
  const { name, avatarImageUrl } = call.participant;

  async function handleAccept(): Promise<void> {
    // The browser asks for the microphone now, with the click on "Annehmen".
    await callAudio.prepare(call.participant.id);
    if (await respond(call.id, "accept")) {
      await navigate(openChatAddress(call));
      return;
    }
    callAudio.discard(call.participant.id);
    showToast({ type: "warning", message: t("chatCall.audio.acceptFailed") });
  }

  return (
    <div
      role="alert"
      className="fixed top-19 right-6 z-60 w-97 max-w-[calc(100vw-3rem)] rounded-[20px] border border-border bg-surface p-4 shadow-[0_16px_40px_rgb(var(--shadow-ink)/0.35)]"
    >
      <div className="flex items-center gap-3">
        <UserAvatar
          name={name}
          avatarType={
            avatarImageUrl ? USER_AVATAR_TYPE.IMAGE : USER_AVATAR_TYPE.INITIALS
          }
          avatarImageUrl={avatarImageUrl}
          className="size-11 text-foreground ring-[3px] ring-primary/35"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] leading-5 font-bold">
            {t("chatCall.incomingTitle", { name })}
          </p>
          <p className="truncate text-xs leading-4 text-muted-foreground">
            {t("chatCall.incomingSource")}
          </p>
        </div>
        <ChatCallBadge>
          <Video aria-hidden="true" className="size-3" />
          {t("chatCall.call")}
        </ChatCallBadge>
      </div>
      <div className="mt-3.5 flex gap-2">
        <button
          type="button"
          className={`${NOTICE_BUTTON} border border-border bg-surface text-foreground hover:bg-muted`}
          onClick={() => void respond(call.id, "decline")}
        >
          {t("chatCall.decline")}
        </button>
        <button
          type="button"
          className={`${NOTICE_BUTTON} bg-primary text-primary-foreground hover:bg-primary-hover`}
          onClick={() => void handleAccept()}
        >
          <Phone aria-hidden="true" className="size-4" />
          {t("chatCall.accept")}
        </button>
      </div>
    </div>
  );
}

/**
 * The notice of an incoming call at the top right, next to the
 * pop-ups of new messages.
 * @remarks
 * Only the account the server names as recipient reads the call, so nobody
 * else sees it. It takes no focus; both buttons are reached with Tab.
 * "Annehmen" opens the direct chat with the running call, "Ablehnen" ends the
 * ringing for both sides.
 */
export function ChatIncomingCall(): React.ReactElement | null {
  const { calls } = useChatCalls();
  const incoming = calls.find(
    (call) => !call.isOutgoing && call.status === "ringing",
  );
  const isShown = incoming !== undefined;

  useEffect(() => {
    if (!isShown) return undefined;
    const root = document.documentElement;
    root.style.setProperty("--call-notice-offset", NOTICE_OFFSET);
    return () => {
      root.style.removeProperty("--call-notice-offset");
    };
  }, [isShown]);

  return incoming ? <IncomingCallCard call={incoming} /> : null;
}
