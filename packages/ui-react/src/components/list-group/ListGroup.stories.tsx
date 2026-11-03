import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../button/Button";
import { Switch } from "../switch/Switch";
import { ListGroup, ListGroupItem } from "./ListGroup";

const meta = {
  component: ListGroup,
  title: "Layout/List Group",
} satisfies Meta<typeof ListGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <ListGroup {...args} style={{ width: 420 }}>
      <ListGroupItem style={{ justifyContent: "space-between" }}>
        Check for updates automatically
        <Switch aria-label="Check for updates automatically" />
      </ListGroupItem>
      <ListGroupItem style={{ justifyContent: "space-between" }}>
        Lucent 0.0.4
        <Button size="sm">Check now</Button>
      </ListGroupItem>
    </ListGroup>
  ),
};
