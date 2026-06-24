export const makeMissingFlashPluginWarning = (
  flashPluginPath: string | null,
): {
  readonly detail: string;
  readonly message: string;
  readonly title: string;
} => {
  const expectedPath =
    flashPluginPath === null
      ? "No supported Pepper Flash plugin path is available for this platform."
      : flashPluginPath;

  return {
    title: "Flash Plugin Missing",
    message: "Lucent could not find the Pepper Flash plugin.",
    detail: [
      "The game window cannot load AQW until Pepper Flash is available.",
      "",
      "Expected plugin path:",
      expectedPath,
      "",
      "Place the plugin at that path or launch Lucent with --flash-plugin-path.",
    ].join("\n"),
  };
};
