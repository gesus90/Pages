import type { McpUserChangeResult } from "./McpUserContract";
import type { McpUserSession } from "./McpUserSession";

/** A change as the history and the operation keys name it. */
export interface McpUserOperation {
  /** The operation of the history, such as `admin.users.create`. */
  readonly name: string;
  readonly operationId: string;
  /** Everything the change depends on except the confirmation, in a fixed field order. */
  readonly request: unknown;
  /** The right a repetition still needs; checked before the stored result answers. */
  readonly guard: (session: McpUserSession) => void;
}

/** What a change did; the temporary password exists only in this object. */
export interface McpUserMutation {
  readonly result: McpUserChangeResult;
  readonly credential?: {
    readonly user: { readonly id: string; readonly username: string };
    readonly temporaryPassword: string;
  };
}

/** A change of the user management, ready for `McpUserApi.change`. */
export interface McpUserCommand {
  readonly operation: McpUserOperation;
  /** The change through the administration services, inside the transaction of the call. */
  readonly apply: (session: McpUserSession) => Promise<McpUserMutation>;
}
