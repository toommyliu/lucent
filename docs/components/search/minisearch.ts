import MiniSearch from "minisearch";

import {
  buildResult,
  RESULT_POOL,
} from "blume/components/layout/search/types.ts";
import type {
  IndexedDocument,
  SearchFn,
} from "blume/components/layout/search/types.ts";

const defaultTokenizer = MiniSearch.getDefault("tokenize");
const LOWER_TO_UPPER = /(\p{Ll}|\d)(\p{Lu})/gu;
const ACRONYM_TO_WORD = /(\p{Lu})(\p{Lu}\p{Ll})/gu;
const IDENTIFIER_SEPARATOR = /[_-]+/gu;
const API_MEMBER = /\bapi(?:\.[A-Za-z_$][\w$]*)+\(\)/gu;

interface ApiMember {
  readonly content: string;
  readonly title: string;
}

const normalizeApiMember = (value: string): string =>
  value
    .trim()
    .replace(/;$/u, "")
    .replace(/\s+/gu, "")
    .replace(/[()]+$/u, "")
    .toLocaleLowerCase();

/** Match a full API member query to the generated member anchor and excerpt. */
const findApiMember = (content: string, query: string): ApiMember | null => {
  const normalizedQuery = normalizeApiMember(query);
  const matches = [...content.matchAll(API_MEMBER)];
  const matchIndex = matches.findIndex(
    (match) => normalizeApiMember(match[0]) === normalizedQuery,
  );
  const match = matches[matchIndex];
  if (match === undefined || match.index === undefined) {
    return null;
  }

  const nextMember = matches
    .slice(matchIndex + 1)
    .find(
      (candidate) =>
        normalizeApiMember(candidate[0]) !== normalizeApiMember(match[0]),
    );

  return {
    content: content.slice(match.index, nextMember?.index).trim(),
    title: match[0],
  };
};

const memberAnchor = (title: string): string =>
  `member-${title
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")}`;

/** Point an exact generated API member match at its heading rather than its page. */
export const resolveApiMemberHit = (
  document: IndexedDocument,
  query: string,
): IndexedDocument => {
  const member = findApiMember(document.content, query);
  if (member === null) {
    return document;
  }

  return {
    ...document,
    content: member.content,
    route: `${document.route}#${memberAnchor(member.title)}`,
    title: member.title,
  };
};

/** Split a camel-case identifier while preserving normal prose tokens. */
const identifierParts = (term: string): string[] =>
  term
    .replace(IDENTIFIER_SEPARATOR, " ")
    .replace(LOWER_TO_UPPER, "$1 $2")
    .replace(ACRONYM_TO_WORD, "$1 $2")
    .split(/\s+/u)
    .filter(Boolean);

/**
 * Add every contiguous identifier segment so a query like `antiCounter` can
 * match the middle of `isAntiCounterEnabled` without indexing arbitrary
 * character n-grams from prose.
 */
export const tokenizeSearchDocument = (text: string): string[] => {
  const terms = new Set<string>();

  for (const term of defaultTokenizer(text)) {
    terms.add(term);
    const parts = identifierParts(term);
    if (parts.length < 2) {
      continue;
    }

    for (let start = 0; start < parts.length; start += 1) {
      let alias = parts[start]?.replace(/^./u, (character) =>
        character.toLocaleLowerCase(),
      );
      if (alias === undefined) {
        continue;
      }
      terms.add(alias);

      for (let end = start + 1; end < parts.length; end += 1) {
        alias += parts[end];
        terms.add(alias);
      }
    }
  }

  return [...terms];
};

/** Build Lucent's client-side search over Blume's generated documents. */
export const createSearchFromDocuments = (
  documents: IndexedDocument[],
): SearchFn => {
  const documentsByRoute = new Map(
    documents.map((document) => [document.route, document]),
  );
  const index = new MiniSearch<IndexedDocument>({
    fields: ["title", "description", "content"],
    idField: "route",
    tokenize: tokenizeSearchDocument,
  });
  index.addAll(documents);

  return (query, options) => {
    const matches = index
      .search(query, {
        boost: { description: 2, title: 4 },
        combineWith: "AND",
        fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
        prefix: (term) => term.length >= 2,
        // Queries retain camel-case compounds; document indexing supplies the
        // compound aliases and individual words they can match against.
        tokenize: defaultTokenizer,
      })
      .flatMap((result) => {
        const document = documentsByRoute.get(String(result.id));
        return document ? [resolveApiMemberHit(document, query)] : [];
      })
      .filter(
        (document) =>
          options?.locale === undefined || document.locale === options.locale,
      )
      .slice(0, RESULT_POOL);

    return Promise.resolve(buildResult(matches, query, options?.section));
  };
};

/** Load Blume's static document list and initialize MiniSearch on demand. */
export const createSearch = async (options: {
  indexUrl: string;
}): Promise<SearchFn> => {
  const response = await fetch(options.indexUrl);
  if (!response.ok) {
    throw new Error(`Failed to load search index (${response.status}).`);
  }
  const documents = (await response.json()) as IndexedDocument[];
  return createSearchFromDocuments(documents);
};
