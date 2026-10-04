import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AtSign,
  Check,
  Copy,
  Eye,
  EyeOff,
  Link,
  Search,
  X,
} from "lucide-react";
import { useState } from "react";
import { fn } from "storybook/test";
import { IconButton } from "../icon-button/IconButton";
import { Button } from "../button/Button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../field/Field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  type InputGroupSize,
} from "./InputGroup";

const sizes = [
  "sm",
  "md",
  "lg",
] as const satisfies ReadonlyArray<InputGroupSize>;

const meta = {
  args: {
    size: "md",
  },
  argTypes: {
    size: { control: "inline-radio", options: sizes },
  },
  component: InputGroup,
  decorators: [
    (Story) => (
      <div style={{ width: 300 }}>
        <Story />
      </div>
    ),
  ],
  title: "Forms/InputGroup",
} satisfies Meta<typeof InputGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Search"
        onValueChange={fn()}
        placeholder="Search files"
        type="search"
      />
    </InputGroup>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12 }}>
      {sizes.map((size) => (
        <InputGroup key={size} size={size}>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput aria-label="Search" placeholder={`Size ${size}`} />
          {size === "sm" ? null : (
            <InputGroupAddon>
              <IconButton label="Clear" size="sm">
                <X />
              </IconButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      ))}
    </div>
  ),
};

export const TextAddons: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      <InputGroup {...args}>
        <InputGroupAddon>https://</InputGroupAddon>
        <InputGroupInput aria-label="Website" placeholder="example.com" />
      </InputGroup>
      <InputGroup {...args}>
        <InputGroupInput aria-label="Subdomain" placeholder="acme" />
        <InputGroupAddon>.example.app</InputGroupAddon>
      </InputGroup>
      <InputGroup {...args}>
        <InputGroupAddon>$</InputGroupAddon>
        <InputGroupInput
          aria-label="Amount"
          inputMode="decimal"
          placeholder="0.00"
        />
        <InputGroupAddon>USD</InputGroupAddon>
      </InputGroup>
    </div>
  ),
};

export const ButtonAddons: Story = {
  render: function ButtonAddonsStory(args) {
    const [visible, setVisible] = useState(false);
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <InputGroup {...args}>
          <InputGroupInput
            aria-label="Password"
            defaultValue="correct-horse-battery"
            type={visible ? "text" : "password"}
          />
          <InputGroupAddon>
            <IconButton
              label={visible ? "Hide password" : "Show password"}
              onClick={() => setVisible((current) => !current)}
              size="sm"
            >
              {visible ? <EyeOff /> : <Eye />}
            </IconButton>
          </InputGroupAddon>
        </InputGroup>
        <InputGroup {...args}>
          <InputGroupAddon>
            <AtSign />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Invite by email"
            placeholder="Invite by email"
          />
          <InputGroupAddon>
            <Button size="sm" variant="soft">
              Invite
            </Button>
          </InputGroupAddon>
        </InputGroup>
      </div>
    );
  },
};

export const States: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 12 }}>
      <InputGroup {...args}>
        <InputGroupAddon>
          <Link />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Read-only link"
          defaultValue="example.app/s/8f2k1"
          readOnly
        />
      </InputGroup>
      <InputGroup {...args}>
        <InputGroupAddon>
          <Link />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Disabled link"
          disabled
          placeholder="Disabled"
        />
      </InputGroup>
      <Field invalid>
        <InputGroup {...args}>
          <InputGroupAddon>https://</InputGroupAddon>
          <InputGroupInput
            aria-label="Invalid website"
            defaultValue="not a url"
          />
        </InputGroup>
      </Field>
    </div>
  ),
};

export const WithField: Story = {
  render: (args) => (
    <Field>
      <FieldLabel>Username</FieldLabel>
      <InputGroup {...args}>
        <InputGroupAddon>example.app/</InputGroupAddon>
        <InputGroupInput
          minLength={3}
          pattern="[a-z0-9-]+"
          placeholder="ada"
          required
        />
      </InputGroup>
      <FieldDescription>
        Lowercase letters, numbers, and dashes.
      </FieldDescription>
      <FieldError match="valueMissing">Choose a username.</FieldError>
      <FieldError match="tooShort">Use at least 3 characters.</FieldError>
      <FieldError match="patternMismatch">
        Use lowercase letters, numbers, and dashes.
      </FieldError>
    </Field>
  ),
};

const shareUrl = "https://example.app/s/8f2k1-quarterly-report";

export const ShareLink: Story = {
  render: function ShareLinkStory(args) {
    const [copied, setCopied] = useState(false);
    return (
      <div
        style={{
          backgroundColor: "var(--color-surface)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-raised)",
          display: "grid",
          gap: 16,
          padding: 16,
          width: 340,
        }}
      >
        <Field>
          <FieldLabel>Invite people</FieldLabel>
          <InputGroup {...args}>
            <InputGroupAddon>
              <AtSign />
            </InputGroupAddon>
            <InputGroupInput placeholder="Name or email" type="email" />
            <InputGroupAddon>
              <Button size="sm" variant="primary">
                Send
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </Field>
        <Field>
          <FieldLabel>Share link</FieldLabel>
          <InputGroup {...args}>
            <InputGroupAddon>
              <Link />
            </InputGroupAddon>
            <InputGroupInput defaultValue={shareUrl} readOnly />
            <InputGroupAddon>
              <IconButton
                label={copied ? "Copied" : "Copy link"}
                onClick={() => setCopied(true)}
                size="sm"
              >
                {copied ? <Check /> : <Copy />}
              </IconButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>Anyone with the link can view.</FieldDescription>
        </Field>
      </div>
    );
  },
};
