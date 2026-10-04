import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bell, Palette, Shield, User } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  SliderControl,
  SliderLabel,
  SliderThumb,
  SliderValue,
  Switch,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Textarea,
  Toaster,
  toast,
} from "../../index";
import styles from "./Examples.module.css";

const languages = [
  { label: "English (US)", value: "en-US" },
  { label: "English (UK)", value: "en-GB" },
  { label: "Deutsch", value: "de" },
  { label: "Español", value: "es" },
  { label: "日本語", value: "ja" },
];

const themes = [
  { label: "Match system", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const notificationSettings = [
  {
    defaultChecked: true,
    description: "When someone mentions you or replies to your comment.",
    label: "Mentions",
    name: "mentions",
  },
  {
    defaultChecked: true,
    description: "A summary of activity in your workspaces, every Monday.",
    label: "Weekly digest",
    name: "digest",
  },
  {
    defaultChecked: false,
    description: "Product news and early access invitations.",
    label: "Announcements",
    name: "announcements",
  },
];

function ProfilePanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Your name and photo are visible to everyone in the workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.formGrid}>
          <Field>
            <FieldLabel>Display name</FieldLabel>
            <Input defaultValue="Ada Lovelace" />
          </Field>
          <Field>
            <FieldLabel>Email</FieldLabel>
            <Input defaultValue="ada@example.com" type="email" />
          </Field>
          <Field>
            <FieldLabel nativeLabel={false} render={<div />}>
              Language
            </FieldLabel>
            <Select defaultValue="en-US" items={languages}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.map((language) => (
                  <SelectItem key={language.value} value={language.value}>
                    {language.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Time zone</FieldLabel>
            <Input defaultValue="Europe/London" readOnly />
            <FieldDescription>Detected from your device.</FieldDescription>
          </Field>
          <Field className={styles.span}>
            <FieldLabel>Bio</FieldLabel>
            <Textarea
              autoResize
              defaultValue="Writing programs for the Analytical Engine."
              maxRows={6}
            />
          </Field>
        </div>
      </CardContent>
      <CardFooter>
        <div className={styles.actions} style={{ width: "100%" }}>
          <Button>Cancel</Button>
          <Button
            onClick={() => toast.success("Profile saved")}
            variant="primary"
          >
            Save changes
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function NotificationsPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Choose what we email you about.</CardDescription>
      </CardHeader>
      <CardContent>
        {notificationSettings.map((setting) => (
          <div className={styles.settingRow} key={setting.name}>
            <div className={styles.settingText}>
              <span id={`${setting.name}-label`}>{setting.label}</span>
              <span className={styles.muted} id={`${setting.name}-description`}>
                {setting.description}
              </span>
            </div>
            <Switch
              aria-describedby={`${setting.name}-description`}
              aria-labelledby={`${setting.name}-label`}
              defaultChecked={setting.defaultChecked}
              name={setting.name}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AppearancePanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Adjust how the app looks on this device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.formGrid}>
          <Field>
            <FieldLabel nativeLabel={false} render={<div />}>
              Theme
            </FieldLabel>
            <Select defaultValue="system" items={themes}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {themes.map((theme) => (
                  <SelectItem key={theme.value} value={theme.value}>
                    {theme.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Slider defaultValue={13} max={18} min={11}>
            <SliderLabel>Text size</SliderLabel>
            <SliderValue />
            <SliderControl>
              <SliderThumb />
            </SliderControl>
          </Slider>
          <Field className={styles.span}>
            <FieldLabel>
              <Switch />
              Reduce motion
            </FieldLabel>
            <FieldDescription style={{ paddingInlineStart: 36 }}>
              Removes movement from animations. Fades stay.
            </FieldDescription>
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Protect your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span>Two-factor authentication</span>
            <span className={styles.muted}>
              Ask for a code from your authenticator app when signing in.
            </span>
          </div>
          <Button size="sm">Set up</Button>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingText}>
            <span>Sign out everywhere</span>
            <span className={styles.muted}>
              Ends every session except this one.
            </span>
          </div>
          <Button size="sm" variant="danger-soft">
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsScreen() {
  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Settings</h1>
            <p className={styles.subtitle}>
              Manage your account and preferences.
            </p>
          </div>
        </div>
        <Tabs defaultValue="profile" orientation="vertical">
          <TabsList variant="underline">
            <TabsTab value="profile">
              <User />
              Profile
            </TabsTab>
            <TabsTab value="notifications">
              <Bell />
              Notifications
            </TabsTab>
            <TabsTab value="appearance">
              <Palette />
              Appearance
            </TabsTab>
            <TabsTab value="security">
              <Shield />
              Security
            </TabsTab>
          </TabsList>
          <TabsPanel value="profile">
            <ProfilePanel />
          </TabsPanel>
          <TabsPanel value="notifications">
            <NotificationsPanel />
          </TabsPanel>
          <TabsPanel value="appearance">
            <AppearancePanel />
          </TabsPanel>
          <TabsPanel value="security">
            <SecurityPanel />
          </TabsPanel>
        </Tabs>
      </div>
      <Toaster />
    </div>
  );
}

const meta = {
  parameters: { layout: "fullscreen" },
  tags: ["!autodocs"],
  title: "Examples/Settings",
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Settings: Story = {
  render: () => <SettingsScreen />,
};
