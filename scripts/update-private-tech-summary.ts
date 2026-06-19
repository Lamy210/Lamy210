#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const README_PATH = path.join(process.cwd(), 'README.md');
const START_MARKER = '<!-- PRIVATE_TECH_START -->';
const END_MARKER = '<!-- PRIVATE_TECH_END -->';
const TOKEN = process.env.PRIVATE_REPO_STATS_TOKEN;
const SUMMARY_MODE = process.env.PRIVATE_TECH_SUMMARY_MODE;
const API_VERSION = '2022-11-28';

type GitHubRepository = {
  private?: boolean;
  fork?: boolean;
  languages_url?: string;
};

type LanguageTotals = Map<string, number>;
type LanguageResponse = Record<string, number>;
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

function renderSummary(languageTotals: LanguageTotals): string {
  const totalBytes = [...languageTotals.values()].reduce((sum, bytes) => sum + bytes, 0);

  if (totalBytes === 0) {
    return [
      START_MARKER,
      'Private repository technology summary is not available yet.',
      END_MARKER,
    ].join('\n');
  }

  const rows = [...languageTotals.entries()]
    .sort(([, aBytes], [, bBytes]) => bBytes - aBytes)
    .slice(0, 8)
    .map(([language, bytes]) => {
      const share = bytes / totalBytes;
      const band = share >= 0.4 ? 'High' : share >= 0.15 ? 'Medium' : 'Low';
      return `| ${language} | ${band} |`;
    });

  return [
    START_MARKER,
    '### Private language summary',
    '',
    '| Language | Activity |',
    '| --- | --- |',
    ...rows,
    '',
    '_Aggregated from private repository language statistics. Repository names, repository lists, exact percentages, and API responses are intentionally omitted._',
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
  for (const repo of repos) {
    if (!repo.private || repo.fork || !repo.languages_url) continue;

    const languages = await requestJson<LanguageResponse>(repo.languages_url);
    for (const [language, bytes] of Object.entries(languages)) {
      languageTotals.set(language, (languageTotals.get(language) || 0) + bytes);
    }
  }

  const nextReadme = replacePrivateTechSection(readme, renderSummary(languageTotals));

  if (nextReadme !== readme) {
    await writeFile(README_PATH, nextReadme);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Update private technology summary failed.';
  console.error(message);
  process.exitCode = 1;
});
