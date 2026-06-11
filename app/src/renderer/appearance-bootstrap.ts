import {
  applyAppearanceSnapshotToDocument,
  readAppearanceSnapshotSearchParams,
} from "../shared/appearance-snapshot";

try {
  const snapshot = readAppearanceSnapshotSearchParams(
    globalThis.location.search,
  );
  if (snapshot) {
    applyAppearanceSnapshotToDocument(document.documentElement, snapshot);
  }
} catch {
  // The preload snapshot is still available as a fallback.
}
