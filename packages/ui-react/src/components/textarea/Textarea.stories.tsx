import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { Button } from "../button/Button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../field/Field";
import { Input } from "../input/Input";
import { Textarea, type TextareaSize } from "./Textarea";

const sizes = ["sm", "md", "lg"] as const satisfies ReadonlyArray<TextareaSize>;

const meta = {
  args: {
    autoResize: false,
    disabled: false,
    minRows: 3,
    onValueChange: fn(),
    placeholder: "Write a message",
    readOnly: false,
    size: "md",
  },
  argTypes: {
    maxRows: { control: { min: 1, type: "number" } },
    minRows: { control: { min: 1, type: "number" } },
    size: { control: "inline-radio", options: sizes },
  },
  component: Textarea,
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
  title: "Forms/Textarea",
} satisfies Meta<typeof Textarea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  args: { minRows: 2 },
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      {sizes.map((size) => (
        <Textarea
          {...args}
          key={size}
          placeholder={`Size ${size}`}
          size={size}
        />
      ))}
    </div>
  ),
};

export const States: Story = {
  args: { minRows: 2 },
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      <Textarea {...args} placeholder="Empty" />
      <Textarea
        {...args}
        defaultValue="Shipped the new onboarding flow. Metrics look good so far."
      />
      <Textarea
        {...args}
        defaultValue="This note was archived and can't be edited."
        readOnly
      />
      <Textarea {...args} disabled placeholder="Disabled" />
      <Field invalid>
        <Textarea {...args} defaultValue="Too short" />
      </Field>
    </div>
  ),
};

export const AutoResize: Story = {
  args: {
    autoResize: true,
    defaultValue:
      "Type more lines to grow the field.\nIt stops growing at six rows and scrolls after that.",
    maxRows: 6,
    minRows: 2,
  },
};

export const RowLimits: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      <Textarea {...args} minRows={1} placeholder="One row minimum" />
      <Textarea {...args} minRows={5} placeholder="Five rows minimum" />
      <Textarea
        {...args}
        maxRows={4}
        minRows={2}
        placeholder="Drag the corner: two to four rows"
      />
    </div>
  ),
};

export const WithField: Story = {
  render: (args) => (
    <Field>
      <FieldLabel>Bio</FieldLabel>
      <Textarea
        {...args}
        minLength={20}
        placeholder="A few words about you"
        required
      />
      <FieldDescription>Shown on your public profile.</FieldDescription>
      <FieldError match="valueMissing">Write a short bio.</FieldError>
      <FieldError match="tooShort">Use at least 20 characters.</FieldError>
    </Field>
  ),
};

const maxLength = 280;

export const FeedbackForm: Story = {
  render: function FeedbackFormStory(args) {
    const [message, setMessage] = useState("");
    const remaining = maxLength - message.length;
    return (
      <form
        onSubmit={(event) => event.preventDefault()}
        style={{ display: "grid", gap: 16 }}
      >
        <Field name="subject">
          <FieldLabel>Subject</FieldLabel>
          <Input placeholder="What's this about?" />
        </Field>
        <Field name="message">
          <FieldLabel>Message</FieldLabel>
          <Textarea
            autoResize
            maxLength={maxLength}
            maxRows={8}
            minRows={4}
            onValueChange={(value, details) => {
              setMessage(value);
              args.onValueChange?.(value, details);
            }}
            placeholder="Tell us what worked and what didn't"
            value={message}
          />
          <FieldDescription
            style={{ fontVariantNumeric: "tabular-nums", textAlign: "end" }}
          >
            {remaining} characters left
          </FieldDescription>
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button onClick={() => setMessage("")} type="button" variant="ghost">
            Clear
          </Button>
          <Button
            disabled={message.trim() === ""}
            type="submit"
            variant="primary"
          >
            Send feedback
          </Button>
        </div>
      </form>
    );
  },
};
