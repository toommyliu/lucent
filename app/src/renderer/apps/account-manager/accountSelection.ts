interface AccountUsernameEntry {
  readonly username: string;
}

export const resolveSelectedAccountUsernames = (
  accounts: readonly AccountUsernameEntry[],
  selectedUsernames: ReadonlySet<string>,
): string[] =>
  accounts
    .filter((account) => selectedUsernames.has(account.username))
    .map((account) => account.username);
