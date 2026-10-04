import * as Schema from "effect/Schema";

export class DesktopWindowError extends Schema.TaggedError<DesktopWindowError>()(
  "DesktopWindowError",
  {
    id: Schema.String,
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
