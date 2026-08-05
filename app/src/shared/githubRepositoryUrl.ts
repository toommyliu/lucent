const GITHUB_HOSTNAME = "github.com";
const GITHUB_PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;

export interface GitHubRepository {
  readonly owner: string;
  readonly repository: string;
  readonly url: string;
}

export type GitHubRepositoryInput =
  | {
      readonly kind: "repository";
      readonly repository: GitHubRepository;
    }
  | {
      readonly kind: "tree";
      readonly ref: string;
      readonly repository: GitHubRepository;
    }
  | { readonly kind: "invalid" };

const invalidInput: GitHubRepositoryInput = { kind: "invalid" };

const repositoryFromSegments = (
  owner: string | undefined,
  rawRepository: string | undefined,
): GitHubRepository | undefined => {
  if (
    owner === undefined ||
    rawRepository === undefined ||
    !GITHUB_PATH_SEGMENT.test(owner) ||
    !GITHUB_PATH_SEGMENT.test(rawRepository)
  ) {
    return undefined;
  }

  const repository = rawRepository.endsWith(".git")
    ? rawRepository.slice(0, -4)
    : rawRepository;
  if (repository === "") return undefined;

  return {
    owner,
    repository,
    url: `https://${GITHUB_HOSTNAME}/${owner}/${repository}`,
  };
};

/** Parses a canonical GitHub repository URL or an unambiguous branch URL. */
export const parseGitHubRepositoryInput = (
  value: string,
): GitHubRepositoryInput => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return invalidInput;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== GITHUB_HOSTNAME ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return invalidInput;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const repository = repositoryFromSegments(segments[0], segments[1]);
  if (repository === undefined) return invalidInput;

  if (segments.length === 2) {
    return { kind: "repository", repository };
  }
  if (segments.length !== 4 || segments[2] !== "tree") return invalidInput;

  try {
    const ref = decodeURIComponent(segments[3] ?? "");
    return ref === "" ? invalidInput : { kind: "tree", ref, repository };
  } catch {
    return invalidInput;
  }
};
