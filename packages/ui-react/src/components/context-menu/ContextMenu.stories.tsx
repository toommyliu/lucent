import type { Meta, StoryObj } from "@storybook/react-vite";
import { Copy, FolderInput, Pencil, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { isolatedStory } from "../../stories/parameters";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuGroupLabel,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSubmenu,
  ContextMenuSubmenuContent,
  ContextMenuSubmenuTrigger,
  ContextMenuTrigger,
} from "./ContextMenu";

const triggerStyle: CSSProperties = {
  alignItems: "center",
  border: "1px dashed var(--color-border)",
  borderRadius: "var(--radius-card)",
  color: "var(--color-text-secondary)",
  display: "flex",
  height: 180,
  justifyContent: "center",
  width: 320,
};

const meta = {
  component: ContextMenuContent,
  parameters: isolatedStory(300),
  title: "Overlays/Context Menu",
} satisfies Meta<typeof ContextMenuContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ContextMenu>
      <ContextMenuTrigger style={triggerStyle}>
        Right-click anywhere in this area
      </ContextMenuTrigger>
      <ContextMenuContent {...args}>
        <ContextMenuItem>
          <Copy />
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
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
  ),
};

export const GroupsAndSubmenu: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger style={triggerStyle}>
        Right-click a file
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuGroupLabel>View</ContextMenuGroupLabel>
          <ContextMenuCheckboxItem defaultChecked>
            Show extensions
          </ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem>Show hidden files</ContextMenuCheckboxItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuSubmenu>
          <ContextMenuSubmenuTrigger>
            <FolderInput />
            Move to
          </ContextMenuSubmenuTrigger>
          <ContextMenuSubmenuContent align="start" side="right" sideOffset={-4}>
            <ContextMenuItem>Inbox</ContextMenuItem>
            <ContextMenuItem>Projects</ContextMenuItem>
            <ContextMenuItem>Archive</ContextMenuItem>
          </ContextMenuSubmenuContent>
        </ContextMenuSubmenu>
      </ContextMenuContent>
    </ContextMenu>
  ),
};
