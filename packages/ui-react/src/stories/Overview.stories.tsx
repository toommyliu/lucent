import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Archive,
  Bold,
  Copy,
  Inbox,
  Italic,
  Pencil,
  Plus,
  Search,
  Trash2,
  Underline,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  ColorPicker,
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
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
  EmptyActions,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Kbd,
  KbdGroup,
  Label,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Slider,
  SliderControl,
  SliderLabel,
  SliderThumb,
  SliderValue,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Textarea,
  Toaster,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  toast,
} from "../index";
import styles from "./Overview.module.css";

interface TileProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly label: string;
  readonly span?: "2" | "full";
}

function Tile({ children, className, label, span }: TileProps) {
  return (
    <div className={styles.tile} data-span={span}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={cn(styles.tileBody, className)}>{children}</div>
    </div>
  );
}

function Section({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{title}</h2>
      <div className={styles.grid}>{children}</div>
    </section>
  );
}

const fruits = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
  { label: "Blueberry", value: "blueberry" },
  { label: "Mango", value: "mango" },
  { label: "Orange", value: "orange" },
];

const members = [
  { email: "ada@example.com", name: "Ada Lovelace", role: "Owner", seats: 12 },
  { email: "alan@example.com", name: "Alan Turing", role: "Admin", seats: 4 },
  {
    email: "grace@example.com",
    name: "Grace Hopper",
    role: "Member",
    seats: 1,
  },
];

function Actions() {
  return (
    <Section title="Actions">
      <Tile label="Button variants" span="2">
        <div className={styles.row}>
          <Button variant="primary">
            <Plus />
            New project
          </Button>
          <Button>Secondary</Button>
          <Button variant="soft">Soft</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="danger-soft">Remove</Button>
        </div>
      </Tile>
      <Tile label="Button sizes and states">
        <div className={styles.row}>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
        <div className={styles.row}>
          <Button disabled>Disabled</Button>
          <Button loading variant="primary">
            Saving
          </Button>
        </div>
      </Tile>
      <Tile label="Icon buttons">
        <TooltipProvider>
          <div className={styles.row}>
            <IconButton label="Rename">
              <Pencil />
            </IconButton>
            <IconButton label="Duplicate">
              <Copy />
            </IconButton>
            <IconButton label="Archive" variant="secondary">
              <Archive />
            </IconButton>
            <IconButton label="Delete" variant="danger-soft">
              <Trash2 />
            </IconButton>
          </div>
        </TooltipProvider>
      </Tile>
    </Section>
  );
}

function Forms() {
  return (
    <Section title="Forms">
      <Tile label="Input">
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input placeholder="you@example.com" type="email" />
          <FieldDescription>We'll only use this for receipts.</FieldDescription>
        </Field>
        <Field invalid>
          <FieldLabel>Username</FieldLabel>
          <Input defaultValue="ada" />
          <FieldError match>That username is taken.</FieldError>
        </Field>
      </Tile>
      <Tile label="Input group and textarea">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput aria-label="Search" placeholder="Search files" />
        </InputGroup>
        <Field>
          <FieldLabel>Notes</FieldLabel>
          <Textarea placeholder="Add a note for reviewers" />
        </Field>
      </Tile>
      <Tile label="Select and combobox">
        <Field>
          <FieldLabel nativeLabel={false} render={<div />}>
            Favorite fruit
          </FieldLabel>
          <Select defaultValue="mango" items={fruits}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fruits.map((fruit) => (
                <SelectItem key={fruit.value} value={fruit.value}>
                  {fruit.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Combobox items={fruits}>
          <ComboboxInputGroup>
            <ComboboxInput aria-label="Fruit" placeholder="Search fruits" />
            <ComboboxTrigger aria-label="Show fruits" />
          </ComboboxInputGroup>
          <ComboboxContent>
            <ComboboxList>
              {(fruit: (typeof fruits)[number]) => (
                <ComboboxItem key={fruit.value} value={fruit}>
                  {fruit.label}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Tile>
      <Tile label="Checkbox and switch">
        <div className={styles.stack}>
          <Field>
            <FieldLabel>
              <Checkbox defaultChecked />
              Email notifications
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel>
              <Checkbox indeterminate />
              Select all
            </FieldLabel>
          </Field>
          <Field disabled>
            <FieldLabel>
              <Checkbox />
              Disabled
            </FieldLabel>
          </Field>
          <Separator />
          <Field>
            <FieldLabel>
              <Switch defaultChecked />
              Automatic updates
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel>
              <Switch />
              Do not disturb
            </FieldLabel>
            <FieldDescription style={{ paddingInlineStart: 36 }}>
              Hold notifications while presenting.
            </FieldDescription>
          </Field>
        </div>
      </Tile>
      <Tile label="Color picker and label">
        <Field>
          <FieldLabel>Accent</FieldLabel>
          <ColorPicker
            defaultValue="#3a83f7"
            triggerLabel="Choose accent color"
          />
        </Field>
        <Label>
          <Checkbox defaultChecked />
          Follow system appearance
        </Label>
      </Tile>
      <Tile label="Slider">
        <Slider defaultValue={40}>
          <SliderLabel>Volume</SliderLabel>
          <SliderValue />
          <SliderControl>
            <SliderThumb />
          </SliderControl>
        </Slider>
        <Slider defaultValue={[20, 70]}>
          <SliderLabel>Price range</SliderLabel>
          <SliderValue />
          <SliderControl>
            <SliderThumb aria-label="Minimum price" index={0} />
            <SliderThumb aria-label="Maximum price" index={1} />
          </SliderControl>
        </Slider>
      </Tile>
    </Section>
  );
}

function Overlays() {
  return (
    <Section title="Overlays">
      <Tile className={styles.overlayAnchor} label="Menu">
        <Menu defaultOpen modal={false}>
          <MenuTrigger render={<Button />}>Options</MenuTrigger>
          <MenuContent>
            <MenuItem>
              <Pencil />
              Rename
              <MenuShortcut>⌘R</MenuShortcut>
            </MenuItem>
            <MenuItem>
              <Copy />
              Duplicate
            </MenuItem>
            <MenuCheckboxItem defaultChecked>Pin to sidebar</MenuCheckboxItem>
            <MenuItem disabled>Move to…</MenuItem>
            <MenuSeparator />
            <MenuItem variant="danger">
              <Trash2 />
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </Tile>
      <Tile className={styles.overlayAnchor} label="Tooltip">
        <TooltipProvider>
          <div className={styles.row} style={{ marginTop: 40 }}>
            <Tooltip defaultOpen>
              <TooltipTrigger
                render={<Button aria-label="Bold" square variant="ghost" />}
              >
                <Bold />
              </TooltipTrigger>
              <TooltipContent>Bold</TooltipContent>
            </Tooltip>
            <IconButton label="Italic">
              <Italic />
            </IconButton>
            <IconButton label="Underline">
              <Underline />
            </IconButton>
          </div>
        </TooltipProvider>
      </Tile>
      <Tile className={styles.overlayAnchor} label="Popover">
        <Popover defaultOpen modal={false}>
          <PopoverTrigger render={<Button />}>Notifications</PopoverTrigger>
          <PopoverContent>
            <PopoverTitle>Notifications</PopoverTitle>
            <PopoverDescription>You're all caught up.</PopoverDescription>
          </PopoverContent>
        </Popover>
      </Tile>
      <Tile label="Context menu">
        <ContextMenu>
          <ContextMenuTrigger className={styles.contextArea}>
            Right-click here
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>
              <Copy />
              Copy
            </ContextMenuItem>
            <ContextMenuItem>
              <Pencil />
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="danger">
              <Trash2 />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Tile>
      <Tile label="Dialogs and toasts">
        <div className={styles.row}>
          <Dialog>
            <DialogTrigger render={<Button />}>Edit profile</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit profile</DialogTitle>
                <DialogDescription>
                  Your name is visible to everyone in the workspace.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <Field>
                  <FieldLabel>Display name</FieldLabel>
                  <Input defaultValue="Ada Lovelace" />
                </Field>
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button />}>Cancel</DialogClose>
                <DialogClose render={<Button variant="primary" />}>
                  Save
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="danger-soft" />}>
              Delete project
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this project?</AlertDialogTitle>
                <AlertDialogDescription>
                  Its files and history are removed for everyone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button />}>Cancel</AlertDialogClose>
                <AlertDialogClose render={<Button variant="danger" />}>
                  Delete
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <div className={styles.row}>
          <Button
            onClick={() => toast("Link copied to clipboard")}
            variant="soft"
          >
            Toast
          </Button>
          <Button
            onClick={() =>
              toast.success("Changes saved", {
                description: "Your profile is up to date.",
              })
            }
            variant="soft"
          >
            Success
          </Button>
          <Button
            onClick={() =>
              toast.error("Upload failed", {
                description: "The file is larger than 25 MB.",
              })
            }
            variant="soft"
          >
            Error
          </Button>
        </div>
      </Tile>
    </Section>
  );
}

function NavigationAndDisclosure() {
  return (
    <Section title="Navigation and disclosure">
      <Tile label="Tabs">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTab value="overview">Overview</TabsTab>
            <TabsTab value="activity">Activity</TabsTab>
            <TabsTab value="settings">Settings</TabsTab>
          </TabsList>
          <TabsPanel value="overview">
            Project health and recent releases.
          </TabsPanel>
          <TabsPanel value="activity">Commits and reviews.</TabsPanel>
          <TabsPanel value="settings">Visibility and integrations.</TabsPanel>
        </Tabs>
        <Tabs defaultValue="code">
          <TabsList variant="underline">
            <TabsTab value="code">Code</TabsTab>
            <TabsTab value="issues">Issues</TabsTab>
            <TabsTab value="pulls">Pull requests</TabsTab>
          </TabsList>
        </Tabs>
      </Tile>
      <Tile label="Accordion" span="2">
        <Accordion defaultValue={["shipping"]}>
          <AccordionItem value="shipping">
            <AccordionTrigger>Shipping</AccordionTrigger>
            <AccordionPanel>
              Orders ship within two business days. Tracking details arrive by
              email once the package leaves the warehouse.
            </AccordionPanel>
          </AccordionItem>
          <AccordionItem value="returns">
            <AccordionTrigger>Returns</AccordionTrigger>
            <AccordionPanel>
              Return unused items within 30 days for a full refund.
            </AccordionPanel>
          </AccordionItem>
          <AccordionItem value="warranty">
            <AccordionTrigger>Warranty</AccordionTrigger>
            <AccordionPanel>
              Every device includes a one-year limited warranty.
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </Tile>
    </Section>
  );
}

function Feedback() {
  return (
    <Section title="Feedback">
      <Tile label="Alerts" span="2">
        <Alert>
          <AlertTitle>Scheduled maintenance</AlertTitle>
          <AlertDescription>
            Sync pauses Sunday from 02:00 to 03:00.
          </AlertDescription>
        </Alert>
        <Alert variant="info">
          <AlertTitle>New sign-in</AlertTitle>
          <AlertDescription>
            A new device signed in from Lisbon.
          </AlertDescription>
        </Alert>
        <Alert variant="success">
          <AlertTitle>Backup complete</AlertTitle>
          <AlertDescription>All 1,204 files are backed up.</AlertDescription>
        </Alert>
        <Alert variant="warning">
          <AlertTitle>Storage almost full</AlertTitle>
          <AlertDescription>You've used 92% of your plan.</AlertDescription>
        </Alert>
        <Alert variant="danger">
          <AlertTitle>Payment failed</AlertTitle>
          <AlertDescription>
            Update your card to keep your plan.
          </AlertDescription>
        </Alert>
      </Tile>
      <Tile label="Spinner and empty state">
        <div className={styles.row}>
          <Spinner label="Loading" />
          <Spinner size={20} />
          <span style={{ color: "var(--color-text-secondary)" }}>Syncing…</span>
        </div>
        <Empty>
          <EmptyMedia>
            <Inbox />
          </EmptyMedia>
          <EmptyTitle>No messages</EmptyTitle>
          <EmptyDescription>New messages show up here.</EmptyDescription>
          <EmptyActions>
            <Button size="sm">Refresh</Button>
          </EmptyActions>
        </Empty>
      </Tile>
    </Section>
  );
}

function Display() {
  return (
    <Section title="Display">
      <Tile label="Badges and keys">
        <div className={styles.row}>
          <Badge>Neutral</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="accent">Accent</Badge>
          <Badge dot variant="success">
            Active
          </Badge>
          <Badge variant="warning">Pending</Badge>
          <Badge variant="danger">Failed</Badge>
          <Badge variant="info">Beta</Badge>
        </div>
        <div className={styles.row}>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>Shift</Kbd>
            <Kbd>P</Kbd>
          </KbdGroup>
        </div>
      </Tile>
      <Tile label="Card">
        <Card>
          <CardHeader>
            <CardTitle>Pro plan</CardTitle>
            <CardDescription>Billed yearly, renews March 1.</CardDescription>
          </CardHeader>
          <CardContent>12 of 20 seats in use.</CardContent>
          <CardFooter>
            <Button size="sm">Manage seats</Button>
          </CardFooter>
        </Card>
      </Tile>
      <Tile label="Table" span="full">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead numeric>Seats</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.email}>
                <TableCell>{member.name}</TableCell>
                <TableCell>{member.email}</TableCell>
                <TableCell>
                  <Badge size="sm">{member.role}</Badge>
                </TableCell>
                <TableCell numeric>{member.seats}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Tile>
    </Section>
  );
}

function OverviewPage() {
  return (
    <div className={styles.page}>
      <Actions />
      <Forms />
      <Overlays />
      <NavigationAndDisclosure />
      <Feedback />
      <Display />
      <Toaster />
    </div>
  );
}

const meta = {
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs"],
  title: "Overview",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const AllComponents: Story = {
  name: "All components",
  render: () => <OverviewPage />,
};
