import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bell, CreditCard, Shield, User } from "lucide-react";
import { fn } from "storybook/test";
import { Button } from "../button/Button";
import { Field, FieldLabel } from "../field/Field";
import { Input } from "../input/Input";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "./Accordion";

const meta = {
  args: {
    disabled: false,
    hiddenUntilFound: false,
    multiple: false,
    onValueChange: fn(),
  },
  component: Accordion,
  decorators: [
    (Story) => (
      <div style={{ width: 400 }}>
        <Story />
      </div>
    ),
  ],
  title: "Disclosure/Accordion",
} satisfies Meta<typeof Accordion>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Accordion {...args} defaultValue={["shipping"]}>
      <AccordionItem value="shipping">
        <AccordionTrigger>Shipping</AccordionTrigger>
        <AccordionPanel>
          Orders ship within two business days. Tracking details arrive by email
          once the package leaves the warehouse.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="returns">
        <AccordionTrigger>Returns</AccordionTrigger>
        <AccordionPanel>
          Return unused items within 30 days for a full refund. Start a return
          from your order history.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="warranty">
        <AccordionTrigger>Warranty</AccordionTrigger>
        <AccordionPanel>
          Every device includes a one-year limited warranty that covers
          manufacturing defects.
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
};

export const Multiple: Story = {
  args: { multiple: true },
  render: (args) => (
    <Accordion {...args} defaultValue={["general", "privacy"]}>
      <AccordionItem value="general">
        <AccordionTrigger>General</AccordionTrigger>
        <AccordionPanel>
          Language, region, and the page that opens when you start the app.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="privacy">
        <AccordionTrigger>Privacy</AccordionTrigger>
        <AccordionPanel>
          Control who can see your profile and whether usage data is shared.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="advanced">
        <AccordionTrigger>Advanced</AccordionTrigger>
        <AccordionPanel>
          Developer tools, experimental features, and cache settings.
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
};

export const DisabledItem: Story = {
  render: (args) => (
    <Accordion {...args}>
      <AccordionItem value="free">
        <AccordionTrigger>Free plan</AccordionTrigger>
        <AccordionPanel>Up to 3 projects and 2 collaborators.</AccordionPanel>
      </AccordionItem>
      <AccordionItem value="team">
        <AccordionTrigger>Team plan</AccordionTrigger>
        <AccordionPanel>
          Unlimited projects, shared libraries, and priority support.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem disabled value="enterprise">
        <AccordionTrigger>Enterprise plan (contact sales)</AccordionTrigger>
        <AccordionPanel>
          SSO, audit logs, and a dedicated manager.
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => (
    <Accordion {...args} defaultValue={["notes"]}>
      <AccordionItem value="notes">
        <AccordionTrigger>Release notes</AccordionTrigger>
        <AccordionPanel>
          Editing is locked while the release is being published.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="assets">
        <AccordionTrigger>Assets</AccordionTrigger>
        <AccordionPanel>
          Installers for macOS, Windows, and Linux.
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
};

export const WithIcons: Story = {
  render: (args) => (
    <Accordion {...args} defaultValue={["account"]}>
      <AccordionItem value="account">
        <AccordionTrigger>
          <User />
          Account
        </AccordionTrigger>
        <AccordionPanel>
          <div style={{ display: "grid", gap: 12, paddingBlock: 4 }}>
            <Field>
              <FieldLabel>Username</FieldLabel>
              <Input defaultValue="ada" />
            </Field>
            <div>
              <Button size="sm" variant="primary">
                Save
              </Button>
            </div>
          </div>
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="notifications">
        <AccordionTrigger>
          <Bell />
          Notifications
        </AccordionTrigger>
        <AccordionPanel>
          Email me about mentions, replies, and weekly summaries.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="security">
        <AccordionTrigger>
          <Shield />
          Security
        </AccordionTrigger>
        <AccordionPanel>
          Two-factor authentication is on. Last sign-in was today from Firefox
          on macOS.
        </AccordionPanel>
      </AccordionItem>
      <AccordionItem value="billing">
        <AccordionTrigger>
          <CreditCard />
          Billing
        </AccordionTrigger>
        <AccordionPanel>Next invoice is due on the 1st.</AccordionPanel>
      </AccordionItem>
    </Accordion>
  ),
};

const faqs = [
  {
    answer:
      "Yes. You can switch plans at any time from Billing settings. Upgrades take effect right away, and downgrades apply at the end of the billing period.",
    question: "Can I change my plan later?",
  },
  {
    answer:
      "Your projects stay available in read-only mode for 30 days. Export them or renew your plan to keep editing.",
    question: "What happens when my trial ends?",
  },
  {
    answer:
      "Data is encrypted in transit and at rest. You can turn on two-factor authentication and require it for everyone in your workspace.",
    question: "How is my data protected?",
  },
  {
    answer:
      "Owners can export every project as a ZIP archive from Workspace settings. Exports include files, comments, and version history.",
    question: "Can I export my data?",
  },
  {
    answer:
      "Restocking fees apply only to opened hardware returned after 14 days.",
    question: "Are there any restocking fees?",
  },
];

export const FAQ: Story = {
  args: { hiddenUntilFound: true },
  render: (args) => (
    <section>
      <h2
        style={{
          fontSize: "var(--font-size-title)",
          fontWeight: 600,
          margin: "0 0 8px",
          paddingInline: 8,
        }}
      >
        Frequently asked questions
      </h2>
      <Accordion {...args}>
        {faqs.map((faq) => (
          <AccordionItem key={faq.question} value={faq.question}>
            <AccordionTrigger>{faq.question}</AccordionTrigger>
            <AccordionPanel>{faq.answer}</AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  ),
};
