import type { Meta, StoryObj } from "@storybook/react-vite";
import { Ellipsis } from "lucide-react";
import { fn } from "storybook/test";
import { Badge, type BadgeVariant } from "../badge/Badge";
import { Button } from "../button/Button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../card/Card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./Table";

const files = [
  { modified: "Today, 09:12", name: "roadmap.pdf", size: "2.4 MB" },
  { modified: "Yesterday", name: "brand-assets.zip", size: "48.1 MB" },
  { modified: "Mar 3", name: "q1-report.xlsx", size: "860 KB" },
  { modified: "Feb 27", name: "onboarding.mp4", size: "212.0 MB" },
];

const members = [
  {
    email: "ada@example.com",
    lastActive: "Now",
    name: "Ada Lovelace",
    role: "Owner",
    status: "Active",
    variant: "success",
  },
  {
    email: "grace@example.com",
    lastActive: "12 min ago",
    name: "Grace Hopper",
    role: "Admin",
    status: "Active",
    variant: "success",
  },
  {
    email: "alan@example.com",
    lastActive: "3 days ago",
    name: "Alan Turing",
    role: "Member",
    status: "Away",
    variant: "warning",
  },
  {
    email: "katherine@example.com",
    lastActive: "Never",
    name: "Katherine Johnson",
    role: "Member",
    status: "Invited",
    variant: "info",
  },
  {
    email: "linus@example.com",
    lastActive: "2 months ago",
    name: "Linus Torvalds",
    role: "Viewer",
    status: "Suspended",
    variant: "danger",
  },
] as const satisfies ReadonlyArray<{
  email: string;
  lastActive: string;
  name: string;
  role: string;
  status: string;
  variant: BadgeVariant;
}>;

const invoice = [
  {
    amount: "$240.00",
    item: "Pro plan, 10 seats",
    quantity: 10,
    rate: "$24.00",
  },
  {
    amount: "$45.00",
    item: "Extra storage, 50 GB",
    quantity: 5,
    rate: "$9.00",
  },
  {
    amount: "$12.50",
    item: "Build minutes overage",
    quantity: 250,
    rate: "$0.05",
  },
];

const events = Array.from({ length: 24 }, (_, index) => ({
  id: `evt_${String(1024 - index).padStart(5, "0")}`,
  status: index % 7 === 3 ? "Failed" : "Delivered",
  time: `14:${String(59 - index * 2).padStart(2, "0")}:08`,
  type: ["push", "deploy", "invite", "billing"][index % 4] ?? "push",
}));

const meta = {
  args: {
    stickyHeader: false,
  },
  component: Table,
  title: "Display/Table",
} satisfies Meta<typeof Table>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div style={{ width: 520 }}>
      <Table {...args}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Modified</TableHead>
            <TableHead numeric>Size</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file) => (
            <TableRow key={file.name}>
              <TableCell>{file.name}</TableCell>
              <TableCell style={{ color: "var(--color-text-secondary)" }}>
                {file.modified}
              </TableCell>
              <TableCell numeric>{file.size}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};

export const SelectedRows: Story = {
  render: (args) => (
    <div style={{ width: 520 }}>
      <Table {...args}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Modified</TableHead>
            <TableHead numeric>Size</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file, index) => (
            <TableRow key={file.name} selected={index === 1 || index === 2}>
              <TableCell>{file.name}</TableCell>
              <TableCell style={{ color: "var(--color-text-secondary)" }}>
                {file.modified}
              </TableCell>
              <TableCell numeric>{file.size}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};

export const NumericWithFooter: Story = {
  name: "Numeric columns, footer, caption",
  render: (args) => (
    <div style={{ width: 560 }}>
      <Table {...args}>
        <TableCaption>Invoice INV-2048, issued March 1.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead numeric>Qty</TableHead>
            <TableHead numeric>Rate</TableHead>
            <TableHead numeric>Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoice.map((line) => (
            <TableRow key={line.item}>
              <TableCell>{line.item}</TableCell>
              <TableCell numeric>{line.quantity}</TableCell>
              <TableCell numeric>{line.rate}</TableCell>
              <TableCell numeric>{line.amount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3}>Total</TableCell>
            <TableCell numeric>$297.50</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  ),
};

export const StickyHeader: Story = {
  args: { stickyHeader: true },
  render: (args) => (
    <div
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-raised)",
        maxHeight: 260,
        overflowY: "auto",
        width: 520,
      }}
    >
      <Table {...args}>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead numeric>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell style={{ fontFamily: "var(--font-mono)" }}>
                {event.id}
              </TableCell>
              <TableCell>{event.type}</TableCell>
              <TableCell>
                <Badge
                  size="sm"
                  variant={event.status === "Failed" ? "danger" : "neutral"}
                >
                  {event.status}
                </Badge>
              </TableCell>
              <TableCell numeric>{event.time}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};

export const TeamMembers: Story = {
  name: "Composition: team members",
  render: (args) => (
    <Card style={{ width: 680 }}>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          5 people have access to this workspace.
        </CardDescription>
        <CardAction>
          <Button onClick={fn()} size="sm" variant="primary">
            Invite
          </Button>
        </CardAction>
      </CardHeader>
      <Table {...args}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last active</TableHead>
            <TableHead>
              <span
                style={{
                  clip: "rect(0 0 0 0)",
                  height: 1,
                  overflow: "hidden",
                  position: "absolute",
                  whiteSpace: "nowrap",
                  width: 1,
                }}
              >
                Actions
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.email}>
              <TableCell>
                <div style={{ display: "grid" }}>
                  <span style={{ fontWeight: 500 }}>{member.name}</span>
                  <span
                    style={{
                      color: "var(--color-text-secondary)",
                      fontSize: "var(--font-size-small)",
                    }}
                  >
                    {member.email}
                  </span>
                </div>
              </TableCell>
              <TableCell>{member.role}</TableCell>
              <TableCell>
                <Badge dot size="sm" variant={member.variant}>
                  {member.status}
                </Badge>
              </TableCell>
              <TableCell style={{ color: "var(--color-text-secondary)" }}>
                {member.lastActive}
              </TableCell>
              <TableCell numeric>
                <Button
                  aria-label={`Actions for ${member.name}`}
                  onClick={fn()}
                  size="sm"
                  square
                  variant="ghost"
                >
                  <Ellipsis />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  ),
};
