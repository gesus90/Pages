import { vi } from "vitest";

import type { UsersActionData } from "@/app/lib/user-actions/user-action-support.server";

/** The router state the agent components read; tests change it between renders. */
export const router = {
  actionData: undefined as UsersActionData | undefined,
  state: "idle",
  formData: undefined as FormData | undefined,
  submit: vi.fn<(formData: FormData, options: unknown) => void>(),
};

/** Restores the idle router before every test. */
export function resetRouter(): void {
  router.actionData = undefined;
  router.state = "idle";
  router.formData = undefined;
  router.submit.mockReset();
}

/** The real router module with only submit, action data and navigation replaced. */
export function withMockedRouter(actual: object): object {
  return {
    ...actual,
    useSubmit: () => router.submit,
    useActionData: () => router.actionData,
    useNavigation: () => router,
  };
}

/** The fields of the form a submit received. */
export function submittedFields(call: number): Record<string, unknown> {
  const formData = router.submit.mock.calls[call]?.[0];
  return formData ? Object.fromEntries(formData.entries()) : {};
}
