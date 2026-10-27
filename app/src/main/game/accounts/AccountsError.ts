import * as Schema from "effect/Schema";

export class AccountsError extends Schema.TaggedError<AccountsError>()(
  "AccountsError",
  {
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const accountError = (detail: string, cause?: unknown): AccountsError =>
  new AccountsError({
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
