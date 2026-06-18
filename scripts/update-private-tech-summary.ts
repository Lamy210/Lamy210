#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const README_PATH = path.join(process.cwd(), 'README.md');
const START_MARKER = '<!-- PRIVATE_TECH_START -->';
const END_MARKER = '<!-- PRIVATE_TECH_END -->';
const TOKEN = process.env.PRIVATE_REPO_STATS_TOKEN;
const API_VERSION = '2022-11-28';

type GitHubRepository = {
  private?: boolean;
  fork?: boolean;
  languages_url?: string;
};

type LanguageTotals = Map<string, number>;
type LanguageResponse = Record<string, number>;
type TechnologyCategory = 'Application' | 'Web' | 'Data' | 'Infrastructure' | 'Other';

const LANGUAGE_CATEGORIES: Record<string, TechnologyCategory> = {
  TypeScript: 'Web',
  JavaScript: 'Web',
  HTML: 'Web',
  CSS: 'Web',
  Vue: 'Web',
  Svelte: 'Web',
  Astro: 'Web',
  Python: 'Data',
  R: 'Data',
  Jupyter Notebook: 'Data',
  SQL: 'Data',
  Dockerfile: 'Infrastructure',
  HCL: 'Infrastructure',
  Terraform: 'Infrastructure',
  Shell: 'Infrastructure',
  'GitHub Actions': 'Infrastructure',
  YAML: 'Infrastructure',
  Go: 'Application',
  Rust: 'Application',
  Java: 'Application',
  Kotlin: 'Application',
  Swift: 'Application',
  C: 'Application',
  'C++': 'Application',
  'C#': 'Application',
  Ruby: 'Application',
  PHP: 'Application',
};

if (!TOKEN) {
  throw new Error('PRIVATE_REPO_STATS_TOKEN is required.');
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${TOKEN}`,
  'X-GitHub-Api-Version': API_VERSION,
  'User-Agent': 'private-tech-summary-updater',
};

async function requestJson<T>(url: string): Promise<T> {
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

function renderSummary(languageTotals: LanguageTotals): string {
  const totalBytes = [...languageTotals.values()].reduce((sum, bytes) => sum + bytes, 0);

  if (totalBytes === 0) {
    return [
      START_MARKER,
      'Private repository technology summary is not available yet.',
      END_MARKER,
    ].join('\n');
  }

  const categoryTotals = new Map<TechnologyCategory, number>();

  for (const [language, bytes] of languageTotals.entries()) {
    const category = LANGUAGE_CATEGORIES[language] || 'Other';
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + bytes);
  }

  const rows = [...categoryTotals.entries()]
    .sort(([, aBytes], [, bBytes]) => bBytes - aBytes)
    .map(([category, bytes]) => {
      const share = bytes / totalBytes;
      const band = share >= 0.4 ? 'High' : share >= 0.15 ? 'Medium' : 'Low';
      return `| ${category} | ${band} |`;
    });

  return [
    START_MARKER,
    '### Private technology summary',
    '',
    '| Area | Activity |',
    '| --- | --- |',
    ...rows,
    '',
    '_Coarse summary only. Repository names, repository lists, language names, exact percentages, and API responses are intentionally omitted._',
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
  const repos = await requestAllPages<GitHubRepository>('https://api.github.com/user/repos?visibility=private&affiliation=owner,collaborator,organization_member&per_page=100');
  const languageTotals: LanguageTotals = new Map();

  for (const repo of repos) {
    if (!repo.private || repo.fork || !repo.languages_url) continue;

    const languages = await requestJson<LanguageResponse>(repo.languages_url);
    for (const [language, bytes] of Object.entries(languages)) {
      languageTotals.set(language, (languageTotals.get(language) || 0) + bytes);
    }
  }

  const readme = await readFile(README_PATH, 'utf8');
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
