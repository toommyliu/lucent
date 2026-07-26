import { describe, expect, it, vi } from "vitest";

import type { ScriptFile } from "../../../../shared/ipc/scripting";
import type { ScriptInputsDefinition } from "@lucent/core/scriptInputs";
import {
  prepareScriptStart,
  type ScriptStartPreparationDependencies,
} from "./scriptStartPreparation";

const requiredInputs: ScriptInputsDefinition = {
  id: "farm",
  fields: [
    {
      key: "item",
      label: "Item",
      required: true,
      type: "string",
    },
  ],
};

const file = (
  revision: string,
  inputs: ScriptInputsDefinition | null = requiredInputs,
): ScriptFile => ({
  inputs,
  name: "farm.js",
  path: "/scripts/farm.js",
  revision,
  source: `// ${revision}`,
});

describe("prepareScriptStart", () => {
  it("uses the loaded snapshot without reading when reload is disabled", async () => {
    const readFile = vi.fn<ScriptStartPreparationDependencies["readFile"]>();
    const getInputValues =
      vi.fn<ScriptStartPreparationDependencies["getInputValues"]>();
    const current = { file: file("one"), inputValues: { item: "Sword" } };

    await expect(
      prepareScriptStart(current, false, { getInputValues, readFile }),
    ).resolves.toEqual({
      ...current,
      status: "ready",
    });
    expect(readFile).not.toHaveBeenCalled();
    expect(getInputValues).not.toHaveBeenCalled();
  });

  it("rereads unchanged source without replacing current inputs", async () => {
    const fresh = file("one");
    const readFile = vi.fn(async () => fresh);
    const getInputValues = vi.fn(async () => ({ item: "Stored" }));

    await expect(
      prepareScriptStart(
        { file: file("one"), inputValues: { item: "Current" } },
        true,
        { getInputValues, readFile },
      ),
    ).resolves.toEqual({
      file: fresh,
      inputValues: { item: "Current" },
      status: "ready",
    });
    expect(readFile).toHaveBeenCalledWith("/scripts/farm.js");
    expect(getInputValues).not.toHaveBeenCalled();
  });

  it("loads persisted inputs for a changed revision", async () => {
    const fresh = file("two");
    const readFile = vi.fn(async () => fresh);
    const getInputValues = vi.fn(async () => ({ item: "Stored" }));

    await expect(
      prepareScriptStart(
        { file: file("one"), inputValues: { item: "Current" } },
        true,
        { getInputValues, readFile },
      ),
    ).resolves.toEqual({
      file: fresh,
      inputValues: { item: "Stored" },
      status: "ready",
    });
    expect(getInputValues).toHaveBeenCalledWith(requiredInputs);
  });

  it("reports newly required inputs from the fresh definition", async () => {
    const fresh = file("two");

    await expect(
      prepareScriptStart(
        { file: file("one"), inputValues: { item: "Current" } },
        true,
        {
          getInputValues: async () => ({}),
          readFile: async () => fresh,
        },
      ),
    ).resolves.toEqual({
      file: fresh,
      inputValues: {},
      status: "missing-required",
    });
  });

  it("clears inputs when the changed script no longer declares them", async () => {
    const fresh = file("two", null);
    const getInputValues = vi.fn(async () => ({ item: "Stored" }));

    await expect(
      prepareScriptStart(
        { file: file("one"), inputValues: { item: "Current" } },
        true,
        {
          getInputValues,
          readFile: async () => fresh,
        },
      ),
    ).resolves.toEqual({
      file: fresh,
      inputValues: {},
      status: "ready",
    });
    expect(getInputValues).not.toHaveBeenCalled();
  });

  it("propagates read failures without consulting input persistence", async () => {
    const error = new Error("read failed");
    const getInputValues = vi.fn(async () => ({ item: "Stored" }));

    await expect(
      prepareScriptStart(
        { file: file("one"), inputValues: { item: "Current" } },
        true,
        {
          getInputValues,
          readFile: async () => Promise.reject(error),
        },
      ),
    ).rejects.toBe(error);
    expect(getInputValues).not.toHaveBeenCalled();
  });

  it("propagates input persistence failures after a changed read", async () => {
    const error = new Error("input read failed");

    await expect(
      prepareScriptStart(
        { file: file("one"), inputValues: { item: "Current" } },
        true,
        {
          getInputValues: async () => Promise.reject(error),
          readFile: async () => file("two"),
        },
      ),
    ).rejects.toBe(error);
  });

  it("rereads again when preparation is retried after input collection", async () => {
    const readFile = vi
      .fn<ScriptStartPreparationDependencies["readFile"]>()
      .mockResolvedValueOnce(file("two"))
      .mockResolvedValueOnce(file("three"));
    const getInputValues = vi
      .fn<ScriptStartPreparationDependencies["getInputValues"]>()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ item: "Sword" });
    const first = await prepareScriptStart(
      { file: file("one"), inputValues: {} },
      true,
      { getInputValues, readFile },
    );

    await expect(
      prepareScriptStart(
        { file: first.file, inputValues: { item: "Sword" } },
        true,
        { getInputValues, readFile },
      ),
    ).resolves.toMatchObject({
      file: { revision: "three" },
      inputValues: { item: "Sword" },
      status: "ready",
    });
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
