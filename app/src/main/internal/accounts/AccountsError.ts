import { Schema } from "effect";

export const AccountOperationSchema = Schema.Literals([
  "close-game-window",
  "create-account",
  "create-group",
  "delete-account",
  "delete-group",
  "focus-game-window",
  "get-game-launch",
  "launch",
  "mkdir",
  "parse",
  "read",
  "rename",
  "refresh-servers",
  "unlink",
  "update-account",
  "update-group",
  "update-script-status",
  "write",
]);

export type AccountOperation = typeof AccountOperationSchema.Type;

export class AccountsError extends Schema.TaggedErrorClass<AccountsError>()(
  "AccountsError",
  {
    operation: AccountOperationSchema,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const accountError = (
  operation: AccountOperation,
  detail: string,
  cause?: unknown,
): AccountsError =>
  new AccountsError({
    operation,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
