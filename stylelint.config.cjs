const runtimeTargets = require("./app/runtime-targets.json");

module.exports = {
  plugins: ["stylelint-no-unsupported-browser-features"],
  rules: {
    "at-rule-disallowed-list": [
      "container",
      "layer",
      "property",
      "scope",
      "starting-style",
    ],
    "function-disallowed-list": [
      "--alpha",
      "--theme",
      "color-mix",
      "lab",
      "lch",
      "oklch",
    ],
    "plugin/no-unsupported-browser-features": [
      true,
      {
        browsers: [`Chrome ${runtimeTargets.chrome}`],
        ignore: ["css-not-sel-list"],
        ignorePartialSupport: true,
        severity: "error",
      },
    ],
    "property-disallowed-list": [
      "accent-color",
      "container",
      "container-name",
      "container-type",
      "scrollbar-color",
      "scrollbar-gutter",
      "scrollbar-width",
      "text-wrap",
    ],
    "selector-disallowed-list": [/:(?:has|is|where)\(/, /&/],
  },
  overrides: [
    {
      files: ["packages/ui-react/**/*.css"],
      rules: {
        "at-rule-disallowed-list": null,
        "function-disallowed-list": null,
        "property-disallowed-list": null,
        "selector-disallowed-list": null,
      },
    },
  ],
};
