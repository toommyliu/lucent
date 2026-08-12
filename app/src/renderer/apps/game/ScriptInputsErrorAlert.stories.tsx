import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { JSX } from "solid-js";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@lucent/ui";
import {
  ScriptInputsErrorAlert,
  type ScriptInputsDialogError,
} from "./ScriptInputsErrorAlert";

function ScriptInputsErrorAlertStory(props: {
  readonly error: ScriptInputsDialogError;
}): JSX.Element {
  return (
    <div class="game-app">
      <Dialog open>
        <DialogContent
          class="game-script-inputs-dialog"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>Script inputs required</DialogTitle>
            <DialogDescription>Example package script</DialogDescription>
          </DialogHeader>
          <ScriptInputsErrorAlert
            error={props.error}
            onFocusField={() => undefined}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

const meta = {
  args: {
    error: {
      fields: [],
      message: "The script inputs could not be saved.",
    },
  },
  component: ScriptInputsErrorAlertStory,
  globals: {
    viewport: { isRotated: false, value: "game" },
  },
  title: "Game/Script Inputs Alert",
} satisfies Meta<typeof ScriptInputsErrorAlertStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PersistenceFailure: Story = {};

export const FieldValidationErrors: Story = {
  args: {
    error: {
      fields: [
        {
          key: "room",
          label: "Room number",
          message: "Enter a value from 1 to 99,999",
        },
        {
          key: "target",
          label: "Target item",
          message: "",
        },
      ],
      message: "Fix the highlighted inputs:",
    },
  },
};
