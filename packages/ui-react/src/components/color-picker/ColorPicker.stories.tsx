import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn, userEvent, within } from "storybook/test";
import { isolatedStory } from "../../stories/parameters";
import { Field, FieldDescription, FieldLabel } from "../field/Field";
import { ColorPicker } from "./ColorPicker";

const meta = {
  args: {
    defaultValue: "#3a83f7",
    disabled: false,
    onValueChange: fn(),
    onValueCommitted: fn(),
    readOnly: false,
    size: "md",
  },
  argTypes: {
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
  },
  component: ColorPicker,
  title: "Forms/Color Picker",
} satisfies Meta<typeof ColorPicker>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <ColorPicker {...args} aria-label="Accent color" />,
};

export const Open: Story = {
  parameters: isolatedStory(280),
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Choose color" }),
    );
  },
  render: (args) => <ColorPicker {...args} aria-label="Accent color" />,
};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
      <ColorPicker {...args} aria-label="Small" size="sm" />
      <ColorPicker {...args} aria-label="Medium" size="md" />
      <ColorPicker {...args} aria-label="Large" size="lg" />
    </div>
  ),
};

export const States: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      <ColorPicker {...args} aria-label="Disabled" disabled />
      <ColorPicker {...args} aria-label="Read-only" readOnly />
    </div>
  ),
};

function ThemeColors() {
  const [background, setBackground] = useState("#fcfcfc");
  const [foreground, setForeground] = useState("#0d0d0d");

  return (
    <div style={{ display: "grid", gap: 16, width: 280 }}>
      <Field>
        <FieldLabel>Background</FieldLabel>
        <ColorPicker
          onValueChange={setBackground}
          triggerLabel="Choose background color"
          value={background}
        />
      </Field>
      <Field>
        <FieldLabel>Foreground</FieldLabel>
        <ColorPicker
          onValueChange={setForeground}
          triggerLabel="Choose foreground color"
          value={foreground}
        />
        <FieldDescription>Used for text and icons.</FieldDescription>
      </Field>
      <div
        style={{
          backgroundColor: background,
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)",
          color: foreground,
          padding: 16,
        }}
      >
        Preview text
      </div>
    </div>
  );
}

export const InFields: Story = {
  render: () => <ThemeColors />,
};
