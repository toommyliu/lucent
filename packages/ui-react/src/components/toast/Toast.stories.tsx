import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect, useState } from "react";
import { fn } from "storybook/test";
import { isolatedStory } from "../../stories/parameters";
import { Button } from "../button/Button";
import {
  toast,
  Toaster,
  type ToasterProps,
  type ToastPlacement,
} from "./Toast";

const placements = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const satisfies ReadonlyArray<ToastPlacement>;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function upload(shouldFail: boolean): Promise<{ name: string }> {
  return wait(1600).then(() => {
    if (shouldFail) {
      throw new Error("The connection was reset.");
    }
    return { name: "quarterly-report.pdf" };
  });
}

function ShowOnMount({ show }: { readonly show: () => void }) {
  useEffect(() => {
    show();
  }, [show]);
  return null;
}

function Row({ children }: { readonly children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 520 }}>
      {children}
    </div>
  );
}

const showSaved = () => {
  toast("Changes saved", {
    description: "Your preferences were updated.",
    id: "saved",
    timeout: 0,
  });
};

const showTypes = () => {
  toast.success("Project created", { id: "types", timeout: 0 });
};

const showAction = () => {
  toast("Conversation archived", {
    action: { label: "Undo", onClick: fn() },
    id: "action",
    timeout: 0,
  });
};

const showDescription = () => {
  toast(null, {
    description: "3 files moved to Archive.",
    id: "description",
    timeout: 0,
  });
};

const showStack = () => {
  toast.info("Build started", { id: "stack-1", timeout: 0 });
  toast.success("Tests passed", {
    description: "128 tests in 14.2s.",
    id: "stack-2",
    timeout: 0,
  });
  toast("Deploying to production", {
    description: "Hover or focus the stack to expand it.",
    id: "stack-3",
    timeout: 0,
  });
};

const showOffline = () => {
  toast.warning("You're offline", {
    description: "Changes will sync when you reconnect.",
    id: "offline",
  });
};

const meta = {
  args: {
    limit: 3,
    placement: "bottom-right",
    timeout: 5000,
  },
  argTypes: {
    limit: { control: { max: 6, min: 1, step: 1, type: "number" } },
    placement: { control: "select", options: placements },
    timeout: { control: { step: 1000, type: "number" } },
  },
  component: Toaster,
  parameters: isolatedStory(360),
  title: "Feedback/Toast",
} satisfies Meta<typeof Toaster>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <>
      <Toaster {...args} />
      <ShowOnMount show={showSaved} />
      <Button
        onClick={() => {
          toast("Changes saved", {
            description: "Your preferences were updated.",
          });
        }}
      >
        Show toast
      </Button>
    </>
  ),
};

export const Types: Story = {
  render: (args) => (
    <>
      <Toaster {...args} />
      <ShowOnMount show={showTypes} />
      <Row>
        <Button onClick={() => toast("Link copied")}>Default</Button>
        <Button
          onClick={() =>
            toast.success("Payment received", {
              description: "A receipt was sent to ada@example.com.",
            })
          }
        >
          Success
        </Button>
        <Button
          onClick={() =>
            toast.error("Couldn't save changes", {
              description: "Check your connection and try again.",
            })
          }
        >
          Error
        </Button>
        <Button
          onClick={() =>
            toast.warning("Storage almost full", {
              description: "You've used 9.1 GB of 10 GB.",
            })
          }
        >
          Warning
        </Button>
        <Button
          onClick={() =>
            toast.info("Update available", {
              description: "Restart to install version 2.4.",
            })
          }
        >
          Info
        </Button>
        <Button
          onClick={() => {
            const id = toast.loading("Syncing files…");
            void wait(2000).then(() => toast.success("Files synced", { id }));
          }}
        >
          Loading
        </Button>
      </Row>
    </>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <>
      <Toaster {...args} />
      <ShowOnMount show={showAction} />
      <Row>
        <Button
          onClick={() =>
            toast("Message deleted", {
              action: {
                label: "Undo",
                onClick: () => toast.success("Message restored"),
              },
            })
          }
        >
          Delete message
        </Button>
        <Button
          onClick={() =>
            toast.error("Upload failed", {
              action: { label: "Retry", onClick: fn() },
              description: "roadmap.pdf couldn't be uploaded.",
            })
          }
        >
          Failed upload
        </Button>
      </Row>
    </>
  ),
};

export const PromiseToast: Story = {
  name: "Promise",
  render: (args) => (
    <>
      <Toaster {...args} />
      <Row>
        <Button
          onClick={() => {
            toast
              .promise(upload(false), {
                error: "Upload failed",
                loading: "Uploading quarterly-report.pdf…",
                success: (file) => ({
                  description: "Anyone with the link can view it.",
                  title: `${file.name} uploaded`,
                }),
              })
              .catch(() => undefined);
          }}
        >
          Upload (succeeds)
        </Button>
        <Button
          onClick={() => {
            toast
              .promise(upload(true), {
                error: (error) => ({
                  action: { label: "Retry", onClick: fn() },
                  description:
                    error instanceof Error ? error.message : "Unknown error.",
                  title: "Upload failed",
                }),
                loading: "Uploading quarterly-report.pdf…",
                success: "Uploaded",
              })
              .catch(() => undefined);
          }}
        >
          Upload (fails)
        </Button>
      </Row>
    </>
  ),
};

export const DescriptionOnly: Story = {
  render: (args) => (
    <>
      <Toaster {...args} />
      <ShowOnMount show={showDescription} />
      <Button
        onClick={() => toast(null, { description: "Copied to clipboard." })}
      >
        Show toast
      </Button>
    </>
  ),
};

export const Stacking: Story = {
  render: (args) => (
    <>
      <Toaster {...args} />
      <ShowOnMount show={showStack} />
      <Row>
        <Button
          onClick={() => {
            toast("Build queued");
          }}
        >
          Add toast
        </Button>
        <Button onClick={() => toast.dismiss()} variant="ghost">
          Dismiss all
        </Button>
      </Row>
    </>
  ),
};

function PlacementsDemo(args: ToasterProps) {
  const [placement, setPlacement] = useState<ToastPlacement>("bottom-right");
  return (
    <>
      <Toaster {...args} placement={placement} />
      <Row>
        {placements.map((value) => (
          <Button
            key={value}
            onClick={() => {
              toast.dismiss();
              setPlacement(value);
              toast(`Placed ${value}`, {
                description: "Swipe toward the nearest edge to dismiss.",
              });
            }}
            variant={value === placement ? "primary" : "secondary"}
          >
            {value}
          </Button>
        ))}
      </Row>
    </>
  );
}

export const Placements: Story = {
  parameters: isolatedStory(420),
  render: (args) => <PlacementsDemo {...args} />,
};

export const Persistent: Story = {
  name: "Persistent (timeout 0)",
  args: { timeout: 0 },
  render: (args) => (
    <>
      <Toaster {...args} />
      <ShowOnMount show={showOffline} />
      <Button onClick={() => toast.dismiss("offline")}>Dismiss</Button>
    </>
  ),
};
