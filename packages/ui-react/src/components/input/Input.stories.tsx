import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../field/Field";
import { Input, type InputSize } from "./Input";

const sizes = ["sm", "md", "lg"] as const satisfies ReadonlyArray<InputSize>;

const meta = {
  args: {
    disabled: false,
    placeholder: "you@example.com",
    readOnly: false,
    size: "md",
    type: "email",
  },
  argTypes: {
    size: { control: "inline-radio", options: sizes },
    type: {
      control: "select",
      options: ["text", "email", "password", "search", "number", "url"],
    },
  },
  component: Input,
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
  title: "Forms/Input",
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      {sizes.map((size) => (
        <Input {...args} key={size} placeholder={`Size ${size}`} size={size} />
      ))}
    </div>
  ),
};

export const States: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      <Input {...args} placeholder="Empty" />
      <Input {...args} defaultValue="ada@example.com" />
      <Input {...args} defaultValue="Read only value" readOnly />
      <Input {...args} disabled placeholder="Disabled" />
      <Field invalid>
        <Input {...args} defaultValue="not-an-email" />
      </Field>
    </div>
  ),
};

export const WithField: Story = {
  render: (args) => (
    <Field>
      <FieldLabel>Email</FieldLabel>
      <Input {...args} required />
      <FieldDescription>We'll only use this for receipts.</FieldDescription>
      <FieldError match="valueMissing">Enter an email address.</FieldError>
      <FieldError match="typeMismatch">Enter a valid email address.</FieldError>
    </Field>
  ),
};
