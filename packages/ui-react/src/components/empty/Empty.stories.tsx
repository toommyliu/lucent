import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CloudUpload,
  FolderPlus,
  Inbox,
  RefreshCw,
  SearchX,
  Server,
} from "lucide-react";
import { fn } from "storybook/test";
import { Button } from "../button/Button";
import { Card } from "../card/Card";
import { Input } from "../input/Input";
import {
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "./Empty";

const meta = {
  component: Empty,
  title: "Feedback/Empty",
} satisfies Meta<typeof Empty>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyMedia>
        <FolderPlus />
      </EmptyMedia>
      <EmptyTitle>No projects yet</EmptyTitle>
      <EmptyDescription>
        Create a project to start tracking builds and deployments.
      </EmptyDescription>
      <EmptyActions>
        <Button onClick={fn()} variant="primary">
          New project
        </Button>
      </EmptyActions>
    </Empty>
  ),
};

export const TitleOnly: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyTitle>Nothing here</EmptyTitle>
    </Empty>
  ),
};

export const WithoutMedia: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyTitle>No notifications</EmptyTitle>
      <EmptyDescription>
        You'll see mentions, reviews, and deploy alerts here.
      </EmptyDescription>
    </Empty>
  ),
};

export const MultipleActions: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyMedia>
        <CloudUpload />
      </EmptyMedia>
      <EmptyTitle>Upload your first file</EmptyTitle>
      <EmptyDescription>
        Drag files here, or choose them from your computer. Files up to 2 GB are
        supported.
      </EmptyDescription>
      <EmptyActions>
        <Button onClick={fn()} variant="ghost">
          Import from URL
        </Button>
        <Button onClick={fn()} variant="primary">
          Choose files
        </Button>
      </EmptyActions>
    </Empty>
  ),
};

export const TitleAsHeading: Story = {
  render: (args) => (
    <Empty {...args}>
      <EmptyMedia>
        <Inbox />
      </EmptyMedia>
      <EmptyTitle render={<h2 />}>Inbox zero</EmptyTitle>
      <EmptyDescription>You're all caught up.</EmptyDescription>
    </Empty>
  ),
};

export const SearchResults: Story = {
  name: "Composition: empty search result",
  render: (args) => (
    <Card style={{ gap: 0, paddingBlock: 0, width: 420 }}>
      <div style={{ padding: 12 }}>
        <Input
          aria-label="Search files"
          defaultValue="quarterly forecast"
          type="search"
        />
      </div>
      <div style={{ borderTop: "1px solid var(--color-separator)" }}>
        <Empty {...args}>
          <EmptyMedia>
            <SearchX />
          </EmptyMedia>
          <EmptyTitle>No results for "quarterly forecast"</EmptyTitle>
          <EmptyDescription>
            Check the spelling or try a broader search term.
          </EmptyDescription>
          <EmptyActions>
            <Button onClick={fn()} size="sm">
              Clear search
            </Button>
          </EmptyActions>
        </Empty>
      </div>
    </Card>
  ),
};

export const LoadError: Story = {
  name: "Composition: failed to load",
  render: (args) => (
    <Card style={{ width: 420 }}>
      <Empty {...args}>
        <EmptyMedia>
          <Server />
        </EmptyMedia>
        <EmptyTitle>Couldn't load deployments</EmptyTitle>
        <EmptyDescription>
          The server didn't respond. Your deployments are safe.
        </EmptyDescription>
        <EmptyActions>
          <Button onClick={fn()} size="sm">
            <RefreshCw />
            Try again
          </Button>
        </EmptyActions>
      </Empty>
    </Card>
  ),
};
