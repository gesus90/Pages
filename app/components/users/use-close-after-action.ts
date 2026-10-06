import { useEffect, useRef } from "react";
import { useUsersActionData } from "@/app/components/users/use-users-action";
import type { UsersIntent } from "@/app/lib/user-actions/user-action-support.server";

/** Closes a dialog for a new successful response, without replaying old successes on reopen. */
export function useCloseAfterAction(
  intent: UsersIntent,
  onClose: () => void,
): void {
  const result = useUsersActionData();
  const previous = useRef(result);
  useEffect(() => {
    if (result === previous.current) return;
    previous.current = result;
    if (result?.intent === intent && result.ok) onClose();
  }, [result, intent, onClose]);
}
