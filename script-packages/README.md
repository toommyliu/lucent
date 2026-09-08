# Vendored script packages

Each directory contains a package bundled with Lucent. Package references are
generated from `package.json` and the declaration file named by `types`.

Document public declarations with JSDoc descriptions, parameter documentation,
and runnable examples. Keep the declarations aligned with the JavaScript exports.
Use either a declaration module matching the package name or an external module
with exports.

Run `pnpm docgen` after changing a package's metadata or declarations. It refreshes
the built-in scripting types first, then generates the package index and one
reference page per package. No package-specific docgen or sidebar entry is needed.
Packages without `types` get an overview without an API reference.
