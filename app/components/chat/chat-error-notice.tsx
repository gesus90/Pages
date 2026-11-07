import { useTranslation } from "react-i18next";

import { chatErrorText } from "./chat-error";

interface ChatErrorNoticeProps {
  /** The stable code of the failure, see {@link chatErrorText}. */
  readonly code: string;
}

/**
 * The failure of the chat as one alert.
 *
 * @remarks
 * A sign-in that ended also offers the login page in a new tab: the person
 * signs in there, and what they typed stays in this one.
 */
export function ChatErrorNotice({
  code,
}: ChatErrorNoticeProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <p
      className="rounded-xl bg-destructive-subtle px-3 py-2 text-sm font-medium text-destructive"
      role="alert"
    >
      {chatErrorText(t, code)}
      {code === "authenticationRequired" ? (
        <>
          {" "}
          <a
            className="underline"
            href="/login"
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("chat.signIn")}
          </a>
        </>
      ) : null}
    </p>
  );
}
