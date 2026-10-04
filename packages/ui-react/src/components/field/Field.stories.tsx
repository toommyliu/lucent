import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "../input/Input";
import { Field, FieldDescription, FieldError, FieldLabel } from "./Field";

const meta = {
  args: {
    disabled: false,
    invalid: false,
    validationMode: "onBlur",
  },
  argTypes: {
    validationMode: {
      control: "inline-radio",
      options: ["onSubmit", "onBlur", "onChange"],
    },
  },
  component: Field,
  decorators: [
    (Story) => (
      <div style={{ width: 300 }}>
        <Story />
      </div>
    ),
  ],
  title: "Forms/Field",
} satisfies Meta<typeof Field>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Field {...args}>
      <FieldLabel>Display name</FieldLabel>
      <Input minLength={3} placeholder="Ada Lovelace" required />
      <FieldDescription>
        Shown on your profile and in comments.
      </FieldDescription>
      <FieldError match="valueMissing">Enter a display name.</FieldError>
      <FieldError match="tooShort">Use at least 3 characters.</FieldError>
    </Field>
  ),
};

export const Invalid: Story = {
  render: () => (
    <Field invalid>
      <FieldLabel>Username</FieldLabel>
      <Input defaultValue="ada" />
      <FieldError match>That username is taken.</FieldError>
    </Field>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Field disabled>
      <FieldLabel>Workspace URL</FieldLabel>
      <Input defaultValue="acme.example.com" />
      <FieldDescription>Contact an admin to change this.</FieldDescription>
    </Field>
  ),
};

export const CustomValidation: Story = {
  render: () => (
    <Field
      validate={(value) =>
        typeof value === "string" && /\s/.test(value)
          ? "Spaces aren't allowed."
          : null
      }
      validationMode="onChange"
    >
      <FieldLabel>Project slug</FieldLabel>
      <Input defaultValue="my project" />
      <FieldDescription>
        Lowercase letters, numbers, and dashes.
      </FieldDescription>
      <FieldError />
    </Field>
  ),
};
