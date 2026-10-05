import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";
import { useEffect } from "react";
import { Button } from "../../components/button/Button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "../../components/field/Field";
import { Input } from "../../components/input/Input";
import styles from "./Foundations.module.css";

interface ThemingArgs {
  readonly accent: string;
  readonly fontSizeBase: number;
  readonly radiusScale: number;
  readonly reduceMotion: "system" | "on" | "off";
}

function useRootOverrides({
  accent,
  fontSizeBase,
  radiusScale,
  reduceMotion,
}: ThemingArgs) {
  useEffect(() => {
    const root = document.documentElement;
    if (accent !== "") {
      root.style.setProperty("--color-accent", accent);
      root.style.setProperty("--color-on-accent", "oklch(1 0 0)");
    }
    root.style.setProperty("--font-size-base", `${fontSizeBase}px`);
    root.style.setProperty("--radius-scale", String(radiusScale));
    if (reduceMotion === "system") {
      delete root.dataset["reduceMotion"];
    } else {
      root.dataset["reduceMotion"] = reduceMotion;
    }
    return () => {
      for (const name of [
        "--color-accent",
        "--color-on-accent",
        "--font-size-base",
        "--radius-scale",
      ]) {
        root.style.removeProperty(name);
      }
      delete root.dataset["reduceMotion"];
    };
  }, [accent, fontSizeBase, radiusScale, reduceMotion]);
}

function ThemingPreview(args: ThemingArgs) {
  useRootOverrides(args);
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.heading}>Host overrides</h2>
        <p className={styles.lede}>
          These controls write to the root element the same way a host app
          applies user appearance settings. Leave the accent empty to keep the
          monochrome default.
        </p>
      </section>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button variant="primary">
          <Plus />
          Create project
        </Button>
        <Button>Secondary</Button>
        <Button variant="soft">Soft</Button>
        <Button variant="ghost">Ghost</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
      </div>
      <div style={{ maxWidth: 320 }}>
        <Field>
          <FieldLabel>Project name</FieldLabel>
          <Input placeholder="Acme dashboard" />
          <FieldDescription>
            Visible to everyone in the workspace.
          </FieldDescription>
        </Field>
      </div>
    </div>
  );
}

const meta = {
  args: {
    accent: "",
    fontSizeBase: 14,
    radiusScale: 1,
    reduceMotion: "system",
  },
  argTypes: {
    accent: { control: "color" },
    fontSizeBase: { control: { max: 18, min: 11, step: 1, type: "range" } },
    radiusScale: { control: { max: 2, min: 0, step: 0.25, type: "range" } },
    reduceMotion: {
      control: "inline-radio",
      options: ["system", "on", "off"],
    },
  },
  component: ThemingPreview,
  parameters: { docs: { story: { inline: false } }, layout: "fullscreen" },
  tags: ["!autodocs"],
  title: "Foundations/Theming",
} satisfies Meta<typeof ThemingPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const HostOverrides: Story = {};

export const BlueAccent: Story = {
  args: { accent: "oklch(0.55 0.19 258)" },
};

export const LargeText: Story = {
  args: { fontSizeBase: 16 },
};

export const Square: Story = {
  args: { radiusScale: 0 },
};
