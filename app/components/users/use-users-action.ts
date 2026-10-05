import { useActionData, useNavigation } from "react-router";

import type {
  UsersActionData,
  UsersErrorCode,
  UsersIntent,
} from "@/app/lib/user-actions/user-action-support.server";

/**
 * Reads the outcome of the latest user directory action.
 *
 * @returns The outcome, which is a new object for every submission, or
 * `undefined` before the first one.
 */
export function useUsersActionData(): UsersActionData | undefined {
  return useActionData<UsersActionData | undefined>();
}

/**
 * Tells whether a form with the given intent is being submitted.
 *
 * @param intent - The directory action to look for.
 */
export function useIsSubmitting(intent: UsersIntent): boolean {
  const navigation = useNavigation();

  return (
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === intent
  );
}

/**
 * Reads why the latest user directory action failed.
 *
 * @param intent - The directory action whose failure the caller shows.
 * @returns The error code, or `null` when the latest outcome is no failure of
 * that action.
 */
export function useUsersError(intent: UsersIntent): UsersErrorCode | null {
  const actionData = useUsersActionData();

  return actionData && !actionData.ok && actionData.intent === intent
    ? actionData.error
    : null;
}
