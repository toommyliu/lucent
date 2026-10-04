import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Archive,
  ChevronDown,
  Copy,
  FolderInput,
  LogOut,
  MoreHorizontal,
  Pencil,
  Settings,
  Share2,
  Trash2,
  User,
} from "lucide-react";
import { useState } from "react";
import { isolatedStory } from "../../stories/parameters";
import { Button } from "../button/Button";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from "./Menu";

const meta = {
  component: MenuContent,
  parameters: isolatedStory(340),
  title: "Overlays/Menu",
} satisfies Meta<typeof MenuContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    align: "start",
    side: "bottom",
    sideOffset: 4,
  },
  argTypes: {
    align: { control: "inline-radio", options: ["start", "center", "end"] },
    side: {
      control: "inline-radio",
      options: ["top", "right", "bottom", "left"],
    },
  },
  render: (args) => (
    <Menu defaultOpen>
      <MenuTrigger render={<Button />}>
        Options
        <ChevronDown />
      </MenuTrigger>
      <MenuContent {...args}>
        <MenuItem>
          <Pencil />
          Rename
          <MenuShortcut>⌘R</MenuShortcut>
        </MenuItem>
        <MenuItem>
          <Copy />
          Duplicate
          <MenuShortcut>⌘D</MenuShortcut>
        </MenuItem>
        <MenuItem>
          <Share2 />
          Share
        </MenuItem>
        <MenuSeparator />
        <MenuItem>
          <Archive />
          Archive
        </MenuItem>
        <MenuItem variant="danger">
          <Trash2 />
          Delete
          <MenuShortcut>⌘⌫</MenuShortcut>
        </MenuItem>
      </MenuContent>
    </Menu>
  ),
};

export const Groups: Story = {
  render: () => (
    <Menu defaultOpen>
      <MenuTrigger render={<Button variant="ghost" />}>
        <User />
        Account
      </MenuTrigger>
      <MenuContent>
        <MenuGroup>
          <MenuGroupLabel>Signed in as ada@example.com</MenuGroupLabel>
          <MenuItem>
            <User />
            Profile
          </MenuItem>
          <MenuItem>
            <Settings />
            Preferences
            <MenuShortcut>⌘,</MenuShortcut>
          </MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Help</MenuGroupLabel>
          <MenuLinkItem href="https://base-ui.com" target="_blank">
            Documentation
          </MenuLinkItem>
          <MenuItem disabled>Release notes</MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem>
          <LogOut />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  ),
};

function CheckboxItemsDemo() {
  const [toolbar, setToolbar] = useState(true);
  const [statusBar, setStatusBar] = useState(false);
  const [minimap, setMinimap] = useState(true);
  return (
    <Menu defaultOpen>
      <MenuTrigger render={<Button />}>View</MenuTrigger>
      <MenuContent>
        <MenuGroup>
          <MenuGroupLabel>Appearance</MenuGroupLabel>
          <MenuCheckboxItem checked={toolbar} onCheckedChange={setToolbar}>
            Toolbar
          </MenuCheckboxItem>
          <MenuCheckboxItem checked={statusBar} onCheckedChange={setStatusBar}>
            Status bar
          </MenuCheckboxItem>
          <MenuCheckboxItem checked={minimap} onCheckedChange={setMinimap}>
            Minimap
          </MenuCheckboxItem>
          <MenuCheckboxItem disabled>Line numbers</MenuCheckboxItem>
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}

export const CheckboxItems: Story = {
  render: () => <CheckboxItemsDemo />,
};

function RadioItemsDemo() {
  const [sort, setSort] = useState("modified");
  return (
    <Menu defaultOpen>
      <MenuTrigger render={<Button variant="soft" />}>
        Sort by
        <ChevronDown />
      </MenuTrigger>
      <MenuContent>
        <MenuRadioGroup onValueChange={setSort} value={sort}>
          <MenuGroupLabel>Sort by</MenuGroupLabel>
          <MenuRadioItem value="name">Name</MenuRadioItem>
          <MenuRadioItem value="modified">Date modified</MenuRadioItem>
          <MenuRadioItem value="size">Size</MenuRadioItem>
          <MenuRadioItem value="kind">Kind</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

export const RadioItems: Story = {
  render: () => <RadioItemsDemo />,
};

export const Submenu: Story = {
  render: () => (
    <Menu defaultOpen>
      <MenuTrigger
        render={<Button aria-label="More actions" square variant="ghost" />}
      >
        <MoreHorizontal />
      </MenuTrigger>
      <MenuContent>
        <MenuItem>
          <Pencil />
          Rename
        </MenuItem>
        <MenuSubmenu defaultOpen>
          <MenuSubmenuTrigger>
            <FolderInput />
            Move to
          </MenuSubmenuTrigger>
          <MenuContent align="start" side="right" sideOffset={-4}>
            <MenuItem>Inbox</MenuItem>
            <MenuItem>Projects</MenuItem>
            <MenuItem>Archive</MenuItem>
            <MenuSeparator />
            <MenuItem>New folder…</MenuItem>
          </MenuContent>
        </MenuSubmenu>
        <MenuSeparator />
        <MenuItem variant="danger">
          <Trash2 />
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  ),
  parameters: isolatedStory(300),
};
