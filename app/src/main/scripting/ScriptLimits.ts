const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * KIBIBYTE;

export const SCRIPT_FILE_MAX_BYTES = 16 * MEBIBYTE;
export const SCRIPT_SNAPSHOT_MAX_BYTES = 64 * MEBIBYTE;

export const SCRIPT_PACKAGE_MANIFEST_MAX_BYTES = MEBIBYTE;
// Package data files may be larger than executable script files.
export const SCRIPT_PACKAGE_FILE_MAX_BYTES = 64 * MEBIBYTE;
export const SCRIPT_PACKAGE_MAX_BYTES = 256 * MEBIBYTE;
export const SCRIPT_PACKAGE_MAX_FILES = 10_000;
export const SCRIPT_PACKAGE_DIRECTORY_SLUG_MAX_BYTES = 120;

export const SCRIPT_PACKAGE_ARCHIVE_MAX_BYTES = 64 * MEBIBYTE;
// Archive inventories count directories as well as files.
export const SCRIPT_PACKAGE_ARCHIVE_MAX_ENTRIES = 10_000;
export const SCRIPT_PACKAGE_ARCHIVE_PATH_MAX_BYTES = KIBIBYTE;
export const SCRIPT_PACKAGE_PATH_COMPONENT_MAX_BYTES = 255;
export const SCRIPT_PACKAGE_METADATA_MAX_BYTES = 16 * MEBIBYTE;

export const SCRIPT_SOURCE_CACHE_MAX_BYTES = 128 * MEBIBYTE;
export const SCRIPT_SOURCE_CACHE_MAX_ENTRIES = 1024;
export const SCRIPT_ANALYSIS_CACHE_MAX_BYTES = 32 * MEBIBYTE;
export const SCRIPT_ANALYSIS_CACHE_MAX_ENTRIES = 64;

export const formatScriptByteLimit = (bytes: number): string => {
  if (bytes % MEBIBYTE === 0) return `${bytes / MEBIBYTE} MiB`;
  if (bytes % KIBIBYTE === 0) return `${bytes / KIBIBYTE} KiB`;
  return `${bytes} bytes`;
};
