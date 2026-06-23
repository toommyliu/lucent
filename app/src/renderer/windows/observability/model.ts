import {
  isGameConsoleObservabilityRecord,
  isObservabilityConsoleMessageData,
  type ObservabilityConsoleMessageData,
  type ObservabilityLevel,
  type ObservabilityRecord,
} from "../../../shared/observability";

export const consoleLevelOptions = [
  "debug",
  "info",
  "warn",
  "error",
] as const satisfies readonly ObservabilityLevel[];

export interface ConsoleRecordFilters {
  readonly accountsByComponent?: ReadonlyMap<string, ConsoleWindowAccount>;
  readonly levels: ReadonlySet<ObservabilityLevel>;
  readonly search: string;
  readonly windowComponent: string;
}

export type ConsoleWindowAccount = NonNullable<
  ObservabilityConsoleMessageData["account"]
>;

const ALL_WINDOWS = "all";

export const allWindowsFilter = ALL_WINDOWS;

const normalizeSearch = (value: string): string =>
  value.trim().toLocaleLowerCase();

const searchableText = (
  record: ObservabilityRecord,
  account: ConsoleWindowAccount | undefined,
): string => {
  const data = isObservabilityConsoleMessageData(record.data)
    ? record.data
    : null;
  const searchAccount = account ?? data?.account;
  return [
    record.level,
    record.component,
    record.message,
    data?.sourceId,
    data?.line,
    searchAccount?.label,
    searchAccount?.username,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLocaleLowerCase();
};

export const filterConsoleRecords = (
  records: readonly ObservabilityRecord[],
  filters: ConsoleRecordFilters,
): readonly ObservabilityRecord[] => {
  const query = normalizeSearch(filters.search);
  return records.filter((record) => {
    if (!isGameConsoleObservabilityRecord(record)) {
      return false;
    }

    if (!filters.levels.has(record.level)) {
      return false;
    }

    if (
      filters.windowComponent !== ALL_WINDOWS &&
      record.component !== filters.windowComponent
    ) {
      return false;
    }

    return (
      query === "" ||
      searchableText(
        record,
        filters.accountsByComponent?.get(record.component),
      ).includes(query)
    );
  });
};

export const consoleRecordKey = (record: ObservabilityRecord): string =>
  `${record.runId}:${record.id}`;

const formatConsoleWindowAccount = (
  component: string,
  account: ConsoleWindowAccount,
): string =>
  account.username === "" || account.label === account.username
    ? `${component} - ${account.label}`
    : `${component} - ${account.label} (${account.username})`;

export const mergeConsoleRecords = (
  current: readonly ObservabilityRecord[],
  next: readonly ObservabilityRecord[],
  limit = 5_000,
): readonly ObservabilityRecord[] => {
  const recordsByKey = new Map<string, ObservabilityRecord>();
  for (const record of current) {
    recordsByKey.set(consoleRecordKey(record), record);
  }
  for (const record of next) {
    if (isGameConsoleObservabilityRecord(record)) {
      recordsByKey.set(consoleRecordKey(record), record);
    }
  }

  return [...recordsByKey.values()]
    .toSorted((left, right) =>
      left.runId === right.runId
        ? left.id - right.id
        : left.timestamp.localeCompare(right.timestamp),
    )
    .slice(-limit);
};

export const excludeConsoleRecordKeys = (
  records: readonly ObservabilityRecord[],
  keys: ReadonlySet<string>,
): readonly ObservabilityRecord[] =>
  keys.size === 0
    ? records
    : records.filter((record) => !keys.has(consoleRecordKey(record)));

export const consoleRecordWindowComponents = (
  records: readonly ObservabilityRecord[],
): readonly string[] =>
  [
    ...new Set(
      records
        .filter(isGameConsoleObservabilityRecord)
        .map((record) => record.component),
    ),
  ].toSorted();

export const formatConsoleRecordWindow = (
  record: ObservabilityRecord,
  accountOverride?: ConsoleWindowAccount,
): string => {
  const data = isObservabilityConsoleMessageData(record.data)
    ? record.data
    : null;
  const account = accountOverride ?? data?.account;
  if (account === undefined) {
    return record.component;
  }

  return formatConsoleWindowAccount(record.component, account);
};

export const formatConsoleRecordWindowComponent = (
  component: string,
  records: readonly ObservabilityRecord[],
  accountOverride?: ConsoleWindowAccount,
): string => {
  if (accountOverride !== undefined) {
    return formatConsoleWindowAccount(component, accountOverride);
  }

  const record =
    records.findLast(
      (candidate) =>
        candidate.component === component &&
        isObservabilityConsoleMessageData(candidate.data) &&
        candidate.data.account !== undefined,
    ) ?? records.findLast((candidate) => candidate.component === component);
  return record === undefined ? component : formatConsoleRecordWindow(record);
};

export const exportConsoleRecords = (
  records: readonly ObservabilityRecord[],
): string => records.map((record) => JSON.stringify(record)).join("\n");

export const formatConsoleTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};
