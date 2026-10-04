import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoreHorizontal, Search, UserPlus } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Field,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Toaster,
  toast,
  type BadgeVariant,
} from "../../index";
import styles from "./Examples.module.css";

type Role = "Owner" | "Admin" | "Member" | "Guest";
type Status = "Active" | "Invited" | "Suspended";

interface Member {
  readonly email: string;
  readonly lastActive: string;
  readonly name: string;
  readonly role: Role;
  readonly status: Status;
}

const statusBadges = {
  Active: "success",
  Invited: "warning",
  Suspended: "danger",
} as const satisfies Record<Status, BadgeVariant>;

const initialMembers: ReadonlyArray<Member> = [
  {
    email: "ada@example.com",
    lastActive: "2 min ago",
    name: "Ada Lovelace",
    role: "Owner",
    status: "Active",
  },
  {
    email: "alan@example.com",
    lastActive: "1 hour ago",
    name: "Alan Turing",
    role: "Admin",
    status: "Active",
  },
  {
    email: "grace@example.com",
    lastActive: "Yesterday",
    name: "Grace Hopper",
    role: "Member",
    status: "Active",
  },
  {
    email: "katherine@example.com",
    lastActive: "Never",
    name: "Katherine Johnson",
    role: "Member",
    status: "Invited",
  },
  {
    email: "linus@example.com",
    lastActive: "3 weeks ago",
    name: "Linus Torvalds",
    role: "Guest",
    status: "Suspended",
  },
];

const roleFilters = [
  { label: "All roles", value: "all" },
  { label: "Owner", value: "Owner" },
  { label: "Admin", value: "Admin" },
  { label: "Member", value: "Member" },
  { label: "Guest", value: "Guest" },
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2);
}

function InviteDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="primary" />}>
        <UserPlus />
        Invite
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite teammates</DialogTitle>
          <DialogDescription>
            Invitations expire after 7 days.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div style={{ display: "grid", gap: 16 }}>
            <Field>
              <FieldLabel>Email addresses</FieldLabel>
              <Input placeholder="name@example.com, another@example.com" />
            </Field>
            <Field>
              <FieldLabel>Message</FieldLabel>
              <Textarea placeholder="Optional note to include in the email" />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <DialogClose
            onClick={() => toast.success("Invitations sent")}
            render={<Button variant="primary" />}
          >
            Send invites
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamMembersScreen() {
  const [members, setMembers] = useState(initialMembers);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string | null>("all");
  const [pendingRemoval, setPendingRemoval] = useState<Member | null>(null);

  const visible = members.filter(
    (member) =>
      (role === "all" || member.role === role) &&
      `${member.name} ${member.email}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <Card>
          <CardHeader>
            <CardTitle>Team members</CardTitle>
            <CardDescription>
              {members.length} people have access to this workspace.
            </CardDescription>
            <CardAction>
              <InviteDialog />
            </CardAction>
          </CardHeader>
          <div className={styles.toolbar}>
            <InputGroup className={styles.grow}>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search members"
                onValueChange={setQuery}
                placeholder="Search by name or email"
                value={query}
              />
            </InputGroup>
            <Select items={roleFilters} onValueChange={setRole} value={role}>
              <SelectTrigger aria-label="Filter by role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleFilters.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {visible.length === 0 ? (
            <Empty>
              <EmptyTitle>No members match</EmptyTitle>
              <EmptyDescription>
                Try a different name or clear the role filter.
              </EmptyDescription>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((member) => (
                  <TableRow key={member.email}>
                    <TableCell>
                      <div className={styles.person}>
                        <span aria-hidden className={styles.initials}>
                          {initials(member.name)}
                        </span>
                        <div className={styles.settingText}>
                          <span>{member.name}</span>
                          <span className={styles.muted}>{member.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{member.role}</TableCell>
                    <TableCell>
                      <Badge
                        dot
                        size="sm"
                        variant={statusBadges[member.status]}
                      >
                        {member.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{member.lastActive}</TableCell>
                    <TableCell>
                      <div className={styles.actions}>
                        <Menu>
                          <MenuTrigger
                            render={
                              <Button
                                aria-label={`Actions for ${member.name}`}
                                size="sm"
                                square
                                variant="ghost"
                              />
                            }
                          >
                            <MoreHorizontal />
                          </MenuTrigger>
                          <MenuContent align="end">
                            <MenuItem>Change role</MenuItem>
                            <MenuItem disabled={member.status !== "Invited"}>
                              Resend invite
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem
                              disabled={member.role === "Owner"}
                              onClick={() => setPendingRemoval(member)}
                              variant="danger"
                            >
                              Remove from workspace
                            </MenuItem>
                          </MenuContent>
                        </Menu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingRemoval(null);
          }
        }}
        open={pendingRemoval !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingRemoval?.name ?? "member"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to every project in this workspace right away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button />}>Cancel</AlertDialogClose>
            <AlertDialogClose
              onClick={() => {
                if (pendingRemoval !== null) {
                  setMembers((current) =>
                    current.filter(
                      (member) => member.email !== pendingRemoval.email,
                    ),
                  );
                  toast(`${pendingRemoval.name} was removed`);
                }
              }}
              render={<Button variant="danger" />}
            >
              Remove
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Toaster />
    </div>
  );
}

const meta = {
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs"],
  title: "Examples/Team members",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const TeamMembers: Story = {
  name: "Team members",
  render: () => <TeamMembersScreen />,
};
