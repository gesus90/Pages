import { useEffect, useState } from "react";

/** How long a notice of the editor stays visible, in milliseconds. */
const NOTICE_DURATION = 5000;

/** A short message of the editor, such as a refused clipboard access. */
export interface EditorNotice {
  readonly message: string | null;
  readonly show: (message: string) => void;
}

/**
 * Holds the latest notice of the editor until it times out.
 *
 * @returns The current message and the function that shows a new one.
 */
export function useEditorNotice(): EditorNotice {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (message === null) {
      return undefined;
    }

    const timer = setTimeout(() => setMessage(null), NOTICE_DURATION);

    return () => clearTimeout(timer);
  }, [message]);

  return { message, show: setMessage };
}
