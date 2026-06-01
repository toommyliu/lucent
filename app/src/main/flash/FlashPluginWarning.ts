export const makeMissingFlashPluginWarning = (
  flashPluginPath: string | null,
): {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
} => {
  const expectedPath =
    flashPluginPath === null
      ? "No platform-specific Pepper Flash plugin path could be resolved."
      : flashPluginPath;

  return {
    title: "Flash Plugin Missing",
    message: "Lucent could not find the Pepper Flash plugin.",
    detail: [
      "The game window cannot load Flash content until the plugin is available.",
      "",
      "Expected plugin path:",
      expectedPath,
      "",
      "Place the plugin at that path, set LUCENT_HOME to a workspace that contains it, or launch Lucent with --flash-plugin-path.",
    ].join("\n"),
  };
};
