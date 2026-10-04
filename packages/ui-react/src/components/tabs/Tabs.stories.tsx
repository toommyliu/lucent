import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Bell,
  Code,
  CreditCard,
  Eye,
  LayoutGrid,
  List,
  Lock,
  Palette,
  User,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { fn } from "storybook/test";
import { Button } from "../button/Button";
import { Field, FieldDescription, FieldLabel } from "../field/Field";
import { Input } from "../input/Input";
import { Tabs, TabsList, TabsPanel, TabsTab, type TabsVariant } from "./Tabs";

const variants = [
  "segmented",
  "underline",
] as const satisfies ReadonlyArray<TabsVariant>;

const onValueChange = fn();

const meta = {
  args: {
    activateOnFocus: false,
    loopFocus: true,
    variant: "segmented",
  },
  argTypes: {
    variant: { control: "inline-radio", options: variants },
  },
  component: TabsList,
  title: "Navigation/Tabs",
} satisfies Meta<typeof TabsList>;

export default meta;

type Story = StoryObj<typeof meta>;

const panelStyle: CSSProperties = {
  color: "var(--color-text-secondary)",
  lineHeight: 1.5,
  margin: 0,
};

function Panel({ children }: { readonly children: ReactNode }) {
  return <p style={panelStyle}>{children}</p>;
}

export const Playground: Story = {
  render: (args) => (
    <Tabs
      defaultValue="overview"
      onValueChange={onValueChange}
      style={{ width: 360 }}
    >
      <TabsList {...args}>
        <TabsTab value="overview">Overview</TabsTab>
        <TabsTab value="activity">Activity</TabsTab>
        <TabsTab value="settings">Settings</TabsTab>
      </TabsList>
      <TabsPanel value="overview">
        <Panel>Project health, recent releases, and open issues.</Panel>
      </TabsPanel>
      <TabsPanel value="activity">
        <Panel>Commits, comments, and reviews from the last 30 days.</Panel>
      </TabsPanel>
      <TabsPanel value="settings">
        <Panel>Visibility, branch rules, and integrations.</Panel>
      </TabsPanel>
    </Tabs>
  ),
};

function VariantDemo({ variant }: { readonly variant: TabsVariant }) {
  return (
    <Tabs defaultValue="all" style={{ width: 360 }}>
      <TabsList variant={variant}>
        <TabsTab value="all">All</TabsTab>
        <TabsTab value="open">Open</TabsTab>
        <TabsTab value="closed">Closed</TabsTab>
        <TabsTab value="drafts">Drafts</TabsTab>
      </TabsList>
      <TabsPanel value="all">
        <Panel>Showing 128 pull requests.</Panel>
      </TabsPanel>
      <TabsPanel value="open">
        <Panel>Showing 12 open pull requests.</Panel>
      </TabsPanel>
      <TabsPanel value="closed">
        <Panel>Showing 109 closed pull requests.</Panel>
      </TabsPanel>
      <TabsPanel value="drafts">
        <Panel>Showing 7 drafts.</Panel>
      </TabsPanel>
    </Tabs>
  );
}

export const Segmented: Story = {
  render: () => <VariantDemo variant="segmented" />,
};

export const Underline: Story = {
  render: () => <VariantDemo variant="underline" />,
};

export const WithIcons: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 24 }}>
      <Tabs defaultValue="preview">
        <TabsList {...args}>
          <TabsTab value="preview">
            <Eye />
            Preview
          </TabsTab>
          <TabsTab value="code">
            <Code />
            Code
          </TabsTab>
        </TabsList>
      </Tabs>
      <Tabs defaultValue="grid">
        <TabsList {...args}>
          <TabsTab aria-label="Grid view" value="grid">
            <LayoutGrid />
          </TabsTab>
          <TabsTab aria-label="List view" value="list">
            <List />
          </TabsTab>
        </TabsList>
      </Tabs>
    </div>
  ),
};

export const DisabledTab: Story = {
  render: (args) => (
    <Tabs defaultValue="members" style={{ width: 360 }}>
      <TabsList {...args}>
        <TabsTab value="members">Members</TabsTab>
        <TabsTab value="groups">Groups</TabsTab>
        <TabsTab disabled value="sso">
          SSO
        </TabsTab>
      </TabsList>
      <TabsPanel value="members">
        <Panel>24 people have access to this workspace.</Panel>
      </TabsPanel>
      <TabsPanel value="groups">
        <Panel>Groups let you manage access for many people at once.</Panel>
      </TabsPanel>
      <TabsPanel value="sso">
        <Panel>Single sign-on is available on the Enterprise plan.</Panel>
      </TabsPanel>
    </Tabs>
  ),
};

function VerticalDemo({ variant }: { readonly variant: TabsVariant }) {
  return (
    <Tabs defaultValue="general" orientation="vertical" style={{ width: 400 }}>
      <TabsList variant={variant}>
        <TabsTab value="general">General</TabsTab>
        <TabsTab value="members">Members</TabsTab>
        <TabsTab value="billing">Billing</TabsTab>
        <TabsTab disabled value="audit">
          Audit log
        </TabsTab>
      </TabsList>
      <TabsPanel value="general">
        <Panel>Workspace name, URL, and default language.</Panel>
      </TabsPanel>
      <TabsPanel value="members">
        <Panel>Invite people and change their roles.</Panel>
      </TabsPanel>
      <TabsPanel value="billing">
        <Panel>Plan, payment method, and invoices.</Panel>
      </TabsPanel>
      <TabsPanel value="audit">
        <Panel>A history of security events in this workspace.</Panel>
      </TabsPanel>
    </Tabs>
  );
}

export const Vertical: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 32 }}>
      <VerticalDemo variant="segmented" />
      <VerticalDemo variant="underline" />
    </div>
  ),
};

const sectionStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  maxWidth: 360,
};

const headingStyle: CSSProperties = {
  fontSize: "var(--font-size-title)",
  fontWeight: 600,
  margin: 0,
};

export const SettingsPage: Story = {
  render: () => (
    <div
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-raised)",
        padding: 20,
        width: 640,
      }}
    >
      <Tabs defaultValue="profile" orientation="vertical">
        <TabsList style={{ width: 160 }} variant="segmented">
          <TabsTab value="profile">
            <User />
            Profile
          </TabsTab>
          <TabsTab value="appearance">
            <Palette />
            Appearance
          </TabsTab>
          <TabsTab value="notifications">
            <Bell />
            Notifications
          </TabsTab>
          <TabsTab value="security">
            <Lock />
            Security
          </TabsTab>
          <TabsTab value="billing">
            <CreditCard />
            Billing
          </TabsTab>
        </TabsList>
        <TabsPanel value="profile">
          <div style={sectionStyle}>
            <h2 style={headingStyle}>Profile</h2>
            <Field>
              <FieldLabel>Display name</FieldLabel>
              <Input defaultValue="Ada Lovelace" />
            </Field>
            <Field>
              <FieldLabel>Email</FieldLabel>
              <Input defaultValue="ada@example.com" type="email" />
              <FieldDescription>
                Used for sign-in and receipts.
              </FieldDescription>
            </Field>
            <div>
              <Button variant="primary">Save changes</Button>
            </div>
          </div>
        </TabsPanel>
        <TabsPanel value="appearance">
          <div style={sectionStyle}>
            <h2 style={headingStyle}>Appearance</h2>
            <Tabs defaultValue="system">
              <TabsList>
                <TabsTab value="light">Light</TabsTab>
                <TabsTab value="dark">Dark</TabsTab>
                <TabsTab value="system">System</TabsTab>
              </TabsList>
            </Tabs>
          </div>
        </TabsPanel>
        <TabsPanel value="notifications">
          <div style={sectionStyle}>
            <h2 style={headingStyle}>Notifications</h2>
            <Panel>Choose which events send you an email.</Panel>
          </div>
        </TabsPanel>
        <TabsPanel value="security">
          <div style={sectionStyle}>
            <h2 style={headingStyle}>Security</h2>
            <Field>
              <FieldLabel>Current password</FieldLabel>
              <Input type="password" />
            </Field>
            <Field>
              <FieldLabel>New password</FieldLabel>
              <Input type="password" />
            </Field>
            <div>
              <Button>Update password</Button>
            </div>
          </div>
        </TabsPanel>
        <TabsPanel value="billing">
          <div style={sectionStyle}>
            <h2 style={headingStyle}>Billing</h2>
            <Panel>You're on the Team plan, billed yearly.</Panel>
          </div>
        </TabsPanel>
      </Tabs>
    </div>
  ),
  parameters: { layout: "padded" },
};
