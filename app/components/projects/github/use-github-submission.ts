import { useState } from "react";
import { useActionData, useNavigation } from "react-router";

/** Which request of the GitHub panel is running and what a test returned. */
export interface GitHubSubmission {
  readonly isSaving: boolean;
  readonly isTesting: boolean;
  /** Result of the last connection test, or `null` while there is none to show. */
  readonly testPassed: boolean | null;
  readonly markTestSubmitted: () => void;
  readonly markSaveSubmitted: () => void;
}

/** Narrows unknown action data to the `{ ok }` result shape of the detail route. */
function isDetailActionResult(
  value: unknown,
): value is { readonly ok: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean"
  );
}

/**
 * Follows the running request of the panel and the result of a connection test.
 *
 * @remarks
 * The result only shows for the last submitted form, so saving afterwards
 * hides the outcome of an earlier test.
 */
export function useGitHubSubmission(): GitHubSubmission {
  const navigation = useNavigation();
  const actionData: unknown = useActionData();
  const [lastSubmittedWasTest, setLastSubmittedWasTest] = useState(false);

  const isSubmitting = navigation.state === "submitting";
  const intent = navigation.formData?.get("intent");
  const hasResult =
    lastSubmittedWasTest &&
    navigation.state === "idle" &&
    isDetailActionResult(actionData);

  return {
    isSaving: isSubmitting && intent === "save-integration",
    isTesting: isSubmitting && intent === "test-integration",
    markSaveSubmitted: () => {
      setLastSubmittedWasTest(false);
    },
    markTestSubmitted: () => {
      setLastSubmittedWasTest(true);
    },
    testPassed: hasResult ? actionData.ok : null,
  };
}
