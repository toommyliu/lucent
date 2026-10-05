import type { Meta, StoryObj } from "@storybook/react-vite";
import styles from "./Foundations.module.css";

const roles = [
  { token: "--font-size-title", use: "Dialog and card titles", weight: 600 },
  {
    token: "--font-size-body",
    use: "Body text, buttons, inputs, menus",
    weight: 400,
  },
  {
    token: "--font-size-small",
    use: "Labels, descriptions, small controls",
    weight: 400,
  },
  {
    token: "--font-size-caption",
    use: "Group labels, keycaps, metadata",
    weight: 400,
  },
] as const;

const weights = [
  { use: "Body copy", value: 400 },
  { use: "Buttons, labels, tabs", value: 500 },
  { use: "Titles", value: 600 },
] as const;

function TypeScale() {
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.heading}>Type roles</h2>
        <p className={styles.lede}>
          Every role derives from --font-size-base (14px by default), so a host
          app can scale all text and control heights by setting one variable.
        </p>
        {roles.map((role) => (
          <div className={styles.typeRow} key={role.token}>
            <div className={styles.meta}>
              <span className={styles.name}>{role.token}</span>
              <span className={styles.note}>{role.use}</span>
            </div>
            <span
              style={{
                fontSize: `var(${role.token})`,
                fontWeight: role.weight,
                lineHeight: 1.4,
              }}
            >
              The quick brown fox jumps over the lazy dog
            </span>
          </div>
        ))}
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>Weights</h2>
        {weights.map((weight) => (
          <div className={styles.typeRow} key={weight.value}>
            <div className={styles.meta}>
              <span className={styles.name}>{weight.value}</span>
              <span className={styles.note}>{weight.use}</span>
            </div>
            <span style={{ fontWeight: weight.value }}>
              Invite teammates to your workspace
            </span>
          </div>
        ))}
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>Numerals and code</h2>
        <div className={styles.typeRow}>
          <div className={styles.meta}>
            <span className={styles.name}>tabular-nums</span>
            <span className={styles.note}>Tables, counters, shortcuts</span>
          </div>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            1,204.50 · 980.00 · 11,111.11
          </span>
        </div>
        <div className={styles.typeRow}>
          <div className={styles.meta}>
            <span className={styles.name}>--font-mono</span>
            <span className={styles.note}>Code, IDs, keys</span>
          </div>
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-size-mono)",
            }}
          >
            const ready = await client.connect(&quot;eu-west&quot;);
          </code>
        </div>
      </section>
    </div>
  );
}

const meta = {
  parameters: { layout: "fullscreen" },
  title: "Foundations/Typography",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Scale: Story = {
  render: () => <TypeScale />,
};
