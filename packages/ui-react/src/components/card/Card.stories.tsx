import type { Meta, StoryObj } from "@storybook/react-vite";
import { CreditCard, Ellipsis, Users } from "lucide-react";
import { fn } from "storybook/test";
import { Badge } from "../badge/Badge";
import { Button } from "../button/Button";
import { Separator } from "../separator/Separator";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";

const meta = {
  args: {
    style: { width: 360 },
  },
  argTypes: {
    style: { control: "object" },
  },
  component: Card,
  title: "Display/Card",
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Project settings</CardTitle>
        <CardDescription>
          Manage how this project builds and deploys.
        </CardDescription>
      </CardHeader>
      <CardContent>
        Builds run on every push to the default branch. Preview deployments are
        created for pull requests.
      </CardContent>
      <CardFooter style={{ justifyContent: "flex-end" }}>
        <Button onClick={fn()} variant="ghost">
          Cancel
        </Button>
        <Button onClick={fn()} variant="primary">
          Save
        </Button>
      </CardFooter>
    </Card>
  ),
};

export const HeaderOnly: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>
          Require a code from your authenticator app when signing in.
        </CardDescription>
      </CardHeader>
    </Card>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <div style={{ display: "grid", gap: 16 }}>
      <Card {...args}>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>8 members, 2 pending invites.</CardDescription>
          <CardAction>
            <Button onClick={fn()} size="sm">
              Invite
            </Button>
          </CardAction>
        </CardHeader>
      </Card>
      <Card {...args}>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardAction>
            <Button
              aria-label="More actions"
              onClick={fn()}
              square
              variant="ghost"
            >
              <Ellipsis />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent style={{ color: "var(--color-text-secondary)" }}>
          Keys grant full access to your account. Store them securely.
        </CardContent>
      </Card>
      <Card {...args}>
        <CardHeader>
          <CardTitle>Production</CardTitle>
          <CardDescription>Last deployed 12 minutes ago.</CardDescription>
          <CardAction>
            <Badge dot size="sm" variant="success">
              Live
            </Badge>
          </CardAction>
        </CardHeader>
      </Card>
    </div>
  ),
};

export const ContentOnly: Story = {
  render: (args) => (
    <Card {...args}>
      <CardContent>
        A card can hold any content. Without a header or footer, it is a padded
        surface.
      </CardContent>
    </Card>
  ),
};

export const TitleAsHeading: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle render={<h2 />}>Danger zone</CardTitle>
        <CardDescription>
          Deleting a project removes its deployments and domains.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button onClick={fn()} variant="danger-soft">
          Delete project
        </Button>
      </CardFooter>
    </Card>
  ),
};

const usage = [
  { label: "Storage", value: "6.2 of 10 GB" },
  { label: "Seats", value: "41 of 50" },
  { label: "Build minutes", value: "1,820 of 3,000" },
];

export const BillingCard: Story = {
  name: "Composition: billing",
  args: { style: { width: 380 } },
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Pro plan</CardTitle>
        <CardDescription>Renews on March 1 for $24.00.</CardDescription>
        <CardAction>
          <Badge variant="accent">Current</Badge>
        </CardAction>
      </CardHeader>
      <CardContent style={{ display: "grid", gap: 8 }}>
        {usage.map(({ label, value }) => (
          <div
            key={label}
            style={{ display: "flex", justifyContent: "space-between" }}
          >
            <span style={{ color: "var(--color-text-secondary)" }}>
              {label}
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
          </div>
        ))}
      </CardContent>
      <Separator />
      <CardContent
        style={{
          alignItems: "center",
          display: "flex",
          gap: 10,
        }}
      >
        <CreditCard
          aria-hidden
          size={16}
          style={{ color: "var(--color-text-secondary)" }}
        />
        <span style={{ flex: 1 }}>Visa ending in 4242</span>
        <Button onClick={fn()} size="sm" variant="ghost">
          Update
        </Button>
      </CardContent>
      <Separator />
      <CardFooter style={{ justifyContent: "space-between" }}>
        <Button onClick={fn()} variant="ghost">
          View invoices
        </Button>
        <Button onClick={fn()} variant="primary">
          Upgrade
        </Button>
      </CardFooter>
    </Card>
  ),
};

const stats = [
  { delta: "+12%", label: "Active users", value: "2,481" },
  { delta: "+3%", label: "Sessions", value: "18,302" },
  { delta: "−1.4%", label: "Error rate", value: "0.42%" },
];

export const StatGrid: Story = {
  name: "Composition: stats",
  args: { style: {} },
  render: (args) => (
    <div
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(3, 180px)",
      }}
    >
      {stats.map(({ delta, label, value }) => (
        <Card {...args} key={label}>
          <CardHeader>
            <CardDescription>{label}</CardDescription>
            <CardAction>
              <Users
                aria-hidden
                size={14}
                style={{ color: "var(--color-text-tertiary)" }}
              />
            </CardAction>
          </CardHeader>
          <CardContent style={{ display: "grid", gap: 2 }}>
            <span
              style={{
                fontSize: 22,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
              }}
            >
              {value}
            </span>
            <span
              style={{
                color: "var(--color-text-secondary)",
                fontSize: "var(--font-size-small)",
              }}
            >
              {delta} from last week
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  ),
};
