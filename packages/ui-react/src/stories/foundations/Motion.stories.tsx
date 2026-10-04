import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../../components/button/Button";
import styles from "./Foundations.module.css";

const tokens = [
  { token: "--ease-out", use: "Every transition in the library" },
  {
    token: "--motion-popup-scale",
    use: "Menus, popovers, tooltips enter from this scale",
  },
  { token: "--motion-dialog-scale", use: "Dialogs enter from this scale" },
  {
    token: "--motion-shift",
    use: "Small offsets such as field errors sliding in",
  },
] as const;

const durations = [
  { token: "--duration-state", use: "Hover, press, color, and border changes" },
  {
    token: "--duration-popup-in",
    use: "Menus, popovers, tooltips, toasts entering",
  },
  { token: "--duration-popup-out", use: "Popups and dialogs leaving" },
  { token: "--duration-dialog", use: "Dialogs and drawers entering" },
] as const;

function MotionReference() {
  const [open, setOpen] = useState(true);
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.heading}>Tokens</h2>
        <p className={styles.lede}>
          Movement reads from these tokens. With reduced motion (the OS setting,
          or data-reduce-motion=&quot;on&quot; on the root) they become no-ops
          and only opacity changes remain.
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Token</th>
              <th>Use</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.token}>
                <td className={styles.name}>{token.token}</td>
                <td>{token.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>Durations</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Token</th>
              <th>Use</th>
            </tr>
          </thead>
          <tbody>
            {durations.map((duration) => (
              <tr key={duration.token}>
                <td className={styles.name}>{duration.token}</td>
                <td>{duration.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>Try it</h2>
        <div className={styles.motionDemo}>
          <Button onClick={() => setOpen((value) => !value)} variant="primary">
            {open ? "Hide popup" : "Show popup"}
          </Button>
          <div
            className={styles.motionBox}
            data-hidden={open ? undefined : ""}
          />
        </div>
        <p className={styles.lede}>
          Toggle quickly to see the transition retarget mid-flight instead of
          restarting. Controls never scale when pressed. Press feedback is a
          color change only.
        </p>
      </section>
    </div>
  );
}

const meta = {
  parameters: { layout: "fullscreen" },
  title: "Foundations/Motion",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Reference: Story = {
  render: () => <MotionReference />,
};
