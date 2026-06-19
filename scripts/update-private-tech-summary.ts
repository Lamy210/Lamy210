#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const README_PATH = path.join(process.cwd(), 'README.md');
const START_MARKER = '<!-- PRIVATE_TECH_START -->';
const END_MARKER = '<!-- PRIVATE_TECH_END -->';
const TOKEN = process.env.PRIVATE_REPO_STATS_TOKEN;
const SUMMARY_MODE = process.env.PRIVATE_TECH_SUMMARY_MODE;
const PINNED_LANGUAGES = (process.env.PRIVATE_TECH_PINNED_LANGUAGES || 'Rust,Go')
  .split(',')
  .map((language) => language.trim())
  .filter(Boolean);
const API_VERSION = '2022-11-28';

type GitHubRepository = {
  private?: boolean;
  fork?: boolean;
  languages_url?: string;
  language?: string | null;
};

type LanguageTotals = Map<string, number>;
type RepositoryLanguageCounts = Map<string, number>;
type LanguageResponse = Record<string, number>;

const LANGUAGE_ICONS: Record<string, string> = {
  TypeScript: 'https://cdn.simpleicons.org/typescript/3178C6',
  JavaScript: 'https://cdn.simpleicons.org/javascript/F7DF1E',
  Python: 'https://cdn.simpleicons.org/python/3776AB',
  Go: 'https://cdn.simpleicons.org/go/00ADD8',
  Rust: 'https://cdn.simpleicons.org/rust/000000',
  Swift: 'https://cdn.simpleicons.org/swift/F05138',
  Kotlin: 'https://cdn.simpleicons.org/kotlin/7F52FF',
  Dart: 'https://cdn.simpleicons.org/dart/0175C2',
  Java: 'https://cdn.simpleicons.org/openjdk/000000',
  Ruby: 'https://cdn.simpleicons.org/ruby/CC342D',
  PHP: 'https://cdn.simpleicons.org/php/777BB4',
  Shell: 'https://cdn.simpleicons.org/gnubash/4EAA25',
  Dockerfile: 'https://cdn.simpleicons.org/docker/2496ED',
  HTML: 'https://cdn.simpleicons.org/html5/E34F26',
  CSS: 'https://cdn.simpleicons.org/css/663399',
  Vue: 'https://cdn.simpleicons.org/vuedotjs/4FC08D',
  Svelte: 'https://cdn.simpleicons.org/svelte/FF3E00',
};

function renderLanguageLabel(language: string): string {
  const iconUrl = LANGUAGE_ICONS[language];
  if (!iconUrl) return language;

  return `<img alt=\"${language} icon\" src=\"${iconUrl}\" width=\"18\" height=\"18\"> ${language}`;
}

const headers = TOKEN
  ? {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'private-tech-summary-updater',
    }
  : null;

async function requestJson<T>(url: string): Promise<T> {
  if (!headers) {
    throw new Error('PRIVATE_REPO_STATS_TOKEN is required for coarse mode.');
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  for (const part of linkHeader.split(',')) {
    const [rawUrl, rawRel] = part.split(';').map((value) => value.trim());
    if (rawUrl && rawRel === 'rel="next"') {
      return rawUrl.slice(1, -1);
    }
  }

  return null;
}

async function requestAllPages<T>(url: string): Promise<T[]> {
  if (!headers) {
    throw new Error('PRIVATE_REPO_STATS_TOKEN is required for coarse mode.');
  }

  const items: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const response = await fetch(nextUrl, { headers });

    if (!response.ok) {
      throw new Error(`GitHub API request failed with status ${response.status}.`);
    }

    const page = (await response.json()) as unknown;
    if (!Array.isArray(page)) {
      throw new Error('GitHub API returned an unexpected response shape.');
    }

    items.push(...(page as T[]));
    nextUrl = parseNextLink(response.headers.get('link'));
  }

  return items;
}

function renderRedactedSummary(): string {
  return [
    START_MARKER,
    'Private repository technology activity is tracked privately. Details are intentionally not published from this public repository.',
    END_MARKER,
  ].join('\n');
}

function getLanguageScore(
  language: string,
  languageTotals: LanguageTotals,
  repositoryLanguageCounts: RepositoryLanguageCounts,
  totalBytes: number,
  totalRepositoryLanguageSignals: number,
): number {
  const byteShare = totalBytes === 0 ? 0 : (languageTotals.get(language) || 0) / totalBytes;
  const repositoryShare = totalRepositoryLanguageSignals === 0
    ? 0
    : (repositoryLanguageCounts.get(language) || 0) / totalRepositoryLanguageSignals;

  return byteShare * 0.65 + repositoryShare * 0.35;
}

function getDisplayLanguages(
  languageTotals: LanguageTotals,
  repositoryLanguageCounts: RepositoryLanguageCounts,
  totalBytes: number,
  totalRepositoryLanguageSignals: number,
): string[] {
  const rankedLanguages = [...new Set([...languageTotals.keys(), ...repositoryLanguageCounts.keys()])]
    .sort((aLanguage, bLanguage) => {
      const scoreDifference = getLanguageScore(
        bLanguage,
        languageTotals,
        repositoryLanguageCounts,
        totalBytes,
        totalRepositoryLanguageSignals,
      ) - getLanguageScore(
        aLanguage,
        languageTotals,
        repositoryLanguageCounts,
        totalBytes,
        totalRepositoryLanguageSignals,
      );

      if (scoreDifference !== 0) return scoreDifference;

      return (languageTotals.get(bLanguage) || 0) - (languageTotals.get(aLanguage) || 0);
    });
  const displayLanguages = rankedLanguages.slice(0, 8);

  for (const pinnedLanguage of PINNED_LANGUAGES) {
    if (
      (languageTotals.has(pinnedLanguage) || repositoryLanguageCounts.has(pinnedLanguage))
      && !displayLanguages.includes(pinnedLanguage)
    ) {
      displayLanguages.push(pinnedLanguage);
    }
  }

  return displayLanguages;
}

function renderSummary(languageTotals: LanguageTotals, repositoryLanguageCounts: RepositoryLanguageCounts): string {
  const totalBytes = [...languageTotals.values()].reduce((sum, bytes) => sum + bytes, 0);
  const totalRepositoryLanguageSignals = [...repositoryLanguageCounts.values()].reduce((sum, count) => sum + count, 0);

  if (totalBytes === 0 && totalRepositoryLanguageSignals === 0) {
    return [
      START_MARKER,
      'Private repository technology summary is not available yet.',
      END_MARKER,
    ].join('\n');
  }

  const rows = getDisplayLanguages(
    languageTotals,
    repositoryLanguageCounts,
    totalBytes,
    totalRepositoryLanguageSignals,
  )
    .map((language) => {
      const score = getLanguageScore(
        language,
        languageTotals,
        repositoryLanguageCounts,
        totalBytes,
        totalRepositoryLanguageSignals,
      );
      const band = score >= 0.4 ? 'High' : score >= 0.15 ? 'Medium' : 'Low';
      return `| ${renderLanguageLabel(language)} | ${band} |`;
    });

  return [
    START_MARKER,
    '### Private language summary',
    '',
    '| Technology | Activity |',
    '| --- | --- |',
    ...rows,
    '',
    "_Aggregated from private repository language statistics and each repository's primary language signal, so smaller Go/Rust repositories are not hidden by byte volume alone. Repository names, repository lists, exact percentages, and API responses are intentionally omitted. Rust and Go are kept visible when GitHub reports them, even if they fall outside the top activity rows._",
    END_MARKER,
  ].join('\n');
}

function replacePrivateTechSection(readme: string, nextSection: string): string {
  const start = readme.indexOf(START_MARKER);
  const end = readme.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end < start) {
    const separator = readme.endsWith('\n') ? '\n' : '\n\n';
    return `${readme}${separator}${nextSection}\n`;
  }

  const before = readme.slice(0, start);
  const after = readme.slice(end + END_MARKER.length);
  return `${before}${nextSection}${after}`;
}

async function main(): Promise<void> {
  const readme = await readFile(README_PATH, 'utf8');

  if (SUMMARY_MODE === 'redacted') {
    const nextReadme = replacePrivateTechSection(readme, renderRedactedSummary());
    if (nextReadme !== readme) {
      await writeFile(README_PATH, nextReadme);
    }
    return;
  }

  const repos = await requestAllPages<GitHubRepository>('https://api.github.com/user/repos?visibility=private&affiliation=owner,collaborator,organization_member&per_page=100');
  const languageTotals: LanguageTotals = new Map();
  const repositoryLanguageCounts: RepositoryLanguageCounts = new Map();
  for (const repo of repos) {
    if (!repo.private || repo.fork) continue;

    if (repo.language) {
      repositoryLanguageCounts.set(repo.language, (repositoryLanguageCounts.get(repo.language) || 0) + 1);
    }

    if (!repo.languages_url) continue;

    const languages = await requestJson<LanguageResponse>(repo.languages_url);
    for (const [language, bytes] of Object.entries(languages)) {
      languageTotals.set(language, (languageTotals.get(language) || 0) + bytes);
    }
  }

  const nextReadme = replacePrivateTechSection(readme, renderSummary(languageTotals, repositoryLanguageCounts));

  if (nextReadme !== readme) {
    await writeFile(README_PATH, nextReadme);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Update private technology summary failed.';
  console.error(message);
  process.exitCode = 1;
});
