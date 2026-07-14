import { describe, expect, it } from "vitest";

import {
  AccountsIpc,
  ArmyIpc,
  CombatProfilesIpc,
  ScriptingIpc,
  SettingsIpc,
  UpdatesIpc,
  WindowsIpc,
  type IpcInvokeDescriptor,
} from "../../shared/ipc";
import { desktopIpcMethods } from "./DesktopIpcHandlers";

const isInvokeDescriptor = (
  descriptor:
    | IpcInvokeDescriptor<unknown, unknown>
    | { readonly channel: string },
): descriptor is IpcInvokeDescriptor<unknown, unknown> =>
  "result" in descriptor;

const expectedDescriptors = [
  ...Object.values(WindowsIpc),
  ...Object.values(AccountsIpc),
  ...Object.values(ArmyIpc),
  ...Object.values(CombatProfilesIpc),
  ...Object.values(SettingsIpc),
  ...Object.values(ScriptingIpc),
  ...Object.values(UpdatesIpc),
].filter(isInvokeDescriptor);

describe("desktop IPC method inventory", () => {
  it("registers every invoke descriptor exactly once", () => {
    const actualChannels = desktopIpcMethods
      .map((method) => method.descriptor.channel)
      .toSorted();
    const expectedChannels = expectedDescriptors
      .map((descriptor) => descriptor.channel)
      .toSorted();

    expect(actualChannels).toEqual(expectedChannels);
    expect(new Set(actualChannels).size).toBe(actualChannels.length);
  });

  it("declares at least one allowed sender for every method", () => {
    for (const method of desktopIpcMethods) {
      expect(method.allowedSenders.length).toBeGreaterThan(0);
    }
  });
});
