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
  topics?: string[];
  contents_url?: string;
};

type LanguageTotals = Map<string, number>;
type RepositoryLanguageCounts = Map<string, number>;
type LanguageResponse = Record<string, number>;
type FrameworkCounts = Map<string, number>;
type FrameworkEvidence = Map<string, Set<string>>;
type ContentResponse = {
  type?: string;
  content?: string;
  encoding?: string;
};

const FRAMEWORK_TOPIC_LABELS: Record<string, string> = {
  react: 'React',
  nextjs: 'Next.js',
  'next-js': 'Next.js',
  vue: 'Vue',
  nuxt: 'Nuxt',
  svelte: 'Svelte',
  sveltekit: 'SvelteKit',
  angular: 'Angular',
  astro: 'Astro',
  remix: 'Remix',
  vite: 'Vite',
  express: 'Express',
  hono: 'Hono',
  fastify: 'Fastify',
  nestjs: 'NestJS',
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  rails: 'Ruby on Rails',
  laravel: 'Laravel',
  symfony: 'Symfony',
  flutter: 'Flutter',
  'react-native': 'React Native',
  expo: 'Expo',
  tauri: 'Tauri',
  electron: 'Electron',
  axum: 'Axum',
  actix: 'Actix',
  gin: 'Gin',
  fiber: 'Fiber',
  echo: 'Echo',
};

const FRAMEWORK_ICONS: Record<string, string> = {
  React: 'https://cdn.simpleicons.org/react/61DAFB',
  'Next.js': 'https://cdn.simpleicons.org/nextdotjs/000000',
  Vue: 'https://cdn.simpleicons.org/vuedotjs/4FC08D',
  Nuxt: 'https://cdn.simpleicons.org/nuxt/00DC82',
  Svelte: 'https://cdn.simpleicons.org/svelte/FF3E00',
  SvelteKit: 'https://cdn.simpleicons.org/svelte/FF3E00',
  Angular: 'https://cdn.simpleicons.org/angular/DD0031',
  Astro: 'https://cdn.simpleicons.org/astro/BC52EE',
  Remix: 'https://cdn.simpleicons.org/remix/000000',
  Vite: 'https://cdn.simpleicons.org/vite/646CFF',
  Express: 'https://cdn.simpleicons.org/express/000000',
  Fastify: 'https://cdn.simpleicons.org/fastify/000000',
  NestJS: 'https://cdn.simpleicons.org/nestjs/E0234E',
  Django: 'https://cdn.simpleicons.org/django/092E20',
  Flask: 'https://cdn.simpleicons.org/flask/000000',
  FastAPI: 'https://cdn.simpleicons.org/fastapi/009688',
  'Ruby on Rails': 'https://cdn.simpleicons.org/rubyonrails/CC0000',
  Laravel: 'https://cdn.simpleicons.org/laravel/FF2D20',
  Symfony: 'https://cdn.simpleicons.org/symfony/000000',
  Flutter: 'https://cdn.simpleicons.org/flutter/02569B',
  'React Native': 'https://cdn.simpleicons.org/react/61DAFB',
  Expo: 'https://cdn.simpleicons.org/expo/000020',
  Tauri: 'https://cdn.simpleicons.org/tauri/FFC131',
  Electron: 'https://cdn.simpleicons.org/electron/47848F',
  Axum: 'https://cdn.simpleicons.org/rust/000000',
  Actix: 'https://cdn.simpleicons.org/rust/000000',
  Gin: 'https://cdn.simpleicons.org/go/00ADD8',
  Hono: 'https://cdn.simpleicons.org/hono/E36002',
  Fiber: 'https://cdn.simpleicons.org/go/00ADD8',
  Echo: 'https://cdn.simpleicons.org/go/00ADD8',
};


const MANIFEST_PATHS = [
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pubspec.yaml',
  'requirements.txt',
  'pyproject.toml',
  'Gemfile',
  'composer.json',
];

const PACKAGE_FRAMEWORK_LABELS: Record<string, string> = {
  react: 'React',
  next: 'Next.js',
  vue: 'Vue',
  nuxt: 'Nuxt',
  svelte: 'Svelte',
  '@sveltejs/kit': 'SvelteKit',
  '@angular/core': 'Angular',
  astro: 'Astro',
  '@remix-run/react': 'Remix',
  vite: 'Vite',
  express: 'Express',
  fastify: 'Fastify',
  '@nestjs/core': 'NestJS',
  hono: 'Hono',
  tauri: 'Tauri',
  '@tauri-apps/api': 'Tauri',
  electron: 'Electron',
  'react-native': 'React Native',
  expo: 'Expo',
};

const TEXT_MANIFEST_FRAMEWORK_PATTERNS: Array<[RegExp, string]> = [
  [/^\s*django(?:[=<>~!]|\s|$)/im, 'Django'],
  [/^\s*flask(?:[=<>~!]|\s|$)/im, 'Flask'],
  [/^\s*fastapi(?:[=<>~!]|\s|$)/im, 'FastAPI'],
  [/\brails\b/i, 'Ruby on Rails'],
  [/\blaravel\/framework\b/i, 'Laravel'],
  [/\bsymfony\//i, 'Symfony'],
  [/\bflutter\s*:/i, 'Flutter'],
  [/\bgithub\.com\/gin-gonic\/gin\b/i, 'Gin'],
  [/\bgithub\.com\/gofiber\/fiber\b/i, 'Fiber'],
  [/\bgithub\.com\/labstack\/echo\b/i, 'Echo'],
  [/\bgithub\.com\/gofiber\/fiber\/v2\b/i, 'Fiber'],
  [/\baxum\b/i, 'Axum'],
  [/\bactix-web\b/i, 'Actix'],
  [/\btauri\b/i, 'Tauri'],
];

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

function renderIconLabel(label: string, iconUrl?: string): string {
  if (!iconUrl) return label;

  return `<img alt=\"${label} icon\" src=\"${iconUrl}\" width=\"18\" height=\"18\"> ${label}`;
}

function renderLanguageLabel(language: string): string {
  return renderIconLabel(language, LANGUAGE_ICONS[language]);
}

function renderFrameworkLabel(framework: string): string {
  return renderIconLabel(framework, FRAMEWORK_ICONS[framework]);
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

function getDisplayLanguages(
  languageTotals: LanguageTotals,
  repositoryLanguageCounts: RepositoryLanguageCounts,
): string[] {
  const rankedLanguages = [...new Set([...languageTotals.keys(), ...repositoryLanguageCounts.keys()])]
    .sort((aLanguage, bLanguage) => {
      const byteDifference = (languageTotals.get(bLanguage) || 0) - (languageTotals.get(aLanguage) || 0);
      if (byteDifference !== 0) return byteDifference;

      return (repositoryLanguageCounts.get(bLanguage) || 0) - (repositoryLanguageCounts.get(aLanguage) || 0);
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

function getPercentValue(numerator: number, denominator: number): number {
  if (denominator === 0 || numerator <= 0) return 0;

  return Number(((numerator / denominator) * 100).toFixed(1));
}

function formatPercentValue(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function addFrameworkSignal(
  frameworkEvidence: FrameworkEvidence,
  framework: string,
  evidence: string,
): void {
  const evidenceSet = frameworkEvidence.get(framework) || new Set<string>();
  evidenceSet.add(evidence);
  frameworkEvidence.set(framework, evidenceSet);
}

function collectTopicFrameworkEvidence(repo: GitHubRepository, frameworkEvidence: FrameworkEvidence): void {
  for (const topic of repo.topics || []) {
    const framework = FRAMEWORK_TOPIC_LABELS[topic.toLowerCase()];
    if (framework) addFrameworkSignal(frameworkEvidence, framework, 'topic');
  }
}

function decodeContentResponse(contentResponse: ContentResponse): string | null {
  if (contentResponse.type !== 'file' || contentResponse.encoding !== 'base64' || !contentResponse.content) {
    return null;
  }

  return Buffer.from(contentResponse.content.replace(/\n/g, ''), 'base64').toString('utf8');
}

async function requestRepositoryFile(repo: GitHubRepository, filePath: string): Promise<string | null> {
  if (!repo.contents_url) return null;

  const url = repo.contents_url.replace('{+path}', filePath);
  const response = await fetch(url, { headers: headers || undefined });

  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub contents API request failed with status ${response.status}.`);
  }

  return decodeContentResponse((await response.json()) as ContentResponse);
}

function collectPackageJsonFrameworkEvidence(fileContent: string, frameworkEvidence: FrameworkEvidence): void {
  try {
    const packageJson = JSON.parse(fileContent) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    for (const packageName of Object.keys(dependencies)) {
      const framework = PACKAGE_FRAMEWORK_LABELS[packageName];
      if (framework) addFrameworkSignal(frameworkEvidence, framework, 'manifest');
    }
  } catch {
    // Ignore malformed manifests so one private repository cannot block the profile update.
  }
}

function collectTextManifestFrameworkEvidence(fileContent: string, frameworkEvidence: FrameworkEvidence): void {
  for (const [pattern, framework] of TEXT_MANIFEST_FRAMEWORK_PATTERNS) {
    if (pattern.test(fileContent)) addFrameworkSignal(frameworkEvidence, framework, 'manifest');
  }
}

async function collectRepositoryFrameworkEvidence(repo: GitHubRepository): Promise<FrameworkEvidence> {
  const frameworkEvidence: FrameworkEvidence = new Map();
  collectTopicFrameworkEvidence(repo, frameworkEvidence);

  for (const manifestPath of MANIFEST_PATHS) {
    try {
      const manifest = await requestRepositoryFile(repo, manifestPath);
      if (!manifest) continue;

      if (manifestPath === 'package.json') {
        collectPackageJsonFrameworkEvidence(manifest, frameworkEvidence);
      } else {
        collectTextManifestFrameworkEvidence(manifest, frameworkEvidence);
      }
    } catch {
      // Keep the profile update resilient when one manifest cannot be read.
    }
  }

  return frameworkEvidence;
}

function mergeFrameworkEvidence(frameworkCounts: FrameworkCounts, frameworkEvidence: FrameworkEvidence): void {
  for (const [framework, evidenceSet] of frameworkEvidence) {
    frameworkCounts.set(framework, (frameworkCounts.get(framework) || 0) + evidenceSet.size);
  }
}

function renderFrameworkTags(frameworkCounts: FrameworkCounts): string[] {
  return [...frameworkCounts.entries()]
    .sort(([aFramework, aCount], [bFramework, bCount]) => {
      if (aCount !== bCount) return bCount - aCount;

      return aFramework.localeCompare(bFramework);
    })
    .slice(0, 10)
    .map(([framework]) => `<code>${renderFrameworkLabel(framework)}</code>`);
}

type LanguageShare = {
  language: string;
  percent: number;
};

function getLanguageShares(displayLanguages: string[], languageTotals: LanguageTotals, totalBytes: number): LanguageShare[] {
  return displayLanguages
    .map((language) => ({
      language,
      percent: getPercentValue(languageTotals.get(language) || 0, totalBytes),
    }))
    .filter(({ percent }) => percent > 0);
}

function getPieLanguageShares(languageShares: LanguageShare[]): LanguageShare[] {
  const topShares = languageShares.slice(0, 8);
  const displayedTotal = topShares.reduce((sum, { percent }) => sum + percent, 0);
  const othersPercent = Number(Math.max(0, 100 - displayedTotal).toFixed(1));

  if (othersPercent > 0) {
    return [...topShares, { language: 'Others', percent: othersPercent }];
  }

  return topShares;
}

function renderMermaidPie(languageShares: LanguageShare[]): string[] {
  const pieRows = getPieLanguageShares(languageShares)
    .filter(({ percent }) => percent > 0)
    .map(({ language, percent }) => `    "${escapeMermaidLabel(language)}" : ${percent.toFixed(1)}`);

  if (pieRows.length === 0) return [];

  return [
    '```mermaid',
    'pie showData',
    '    title Private Language Distribution by Code Volume',
    ...pieRows,
    '```',
  ];
}

function renderSummary(
  languageTotals: LanguageTotals,
  repositoryLanguageCounts: RepositoryLanguageCounts,
  frameworkCounts: FrameworkCounts,
): string {
  const totalBytes = [...languageTotals.values()].reduce((sum, bytes) => sum + bytes, 0);

  if (totalBytes === 0 && repositoryLanguageCounts.size === 0) {
    return [
      START_MARKER,
      'Private repository technology summary is not available yet.',
      END_MARKER,
    ].join('\n');
  }

  const displayLanguages = getDisplayLanguages(
    languageTotals,
    repositoryLanguageCounts,
  );
  const languageShares = getLanguageShares(displayLanguages, languageTotals, totalBytes);
  const languageRows = languageShares
    .map(({ language, percent }) => `| ${renderLanguageLabel(language)} | ${formatPercentValue(percent)} | Language |`);
  const frameworkTags = renderFrameworkTags(frameworkCounts);

  return [
    START_MARKER,
    '### Private technology summary',
    '',
    ...renderMermaidPie(languageShares),
    '',
    '| Technology | Code share | Category |',
    '| --- | ---: | --- |',
    ...languageRows,
    ...(frameworkTags.length > 0
      ? [
          '',
          '### Private framework & tool signals',
          '',
          frameworkTags.join(' '),
        ]
      : []),
    '',
    "_Private repositories are summarized only as coarse technology signals. Language shares use GitHub-reported code volume, and framework/tool signals come from repository topics plus common manifest files. Repository names, products, commits, branches, paths, exact code volume, repository counts, and business context are intentionally not published. Rust and Go are kept visible when GitHub reports them, even if they fall outside the top activity rows._",
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
  const frameworkCounts: FrameworkCounts = new Map();

  for (const repo of repos) {
    if (!repo.private || repo.fork) continue;

    mergeFrameworkEvidence(frameworkCounts, await collectRepositoryFrameworkEvidence(repo));

    if (repo.language) {
      repositoryLanguageCounts.set(repo.language, (repositoryLanguageCounts.get(repo.language) || 0) + 1);
    }

    if (!repo.languages_url) continue;

    const languages = await requestJson<LanguageResponse>(repo.languages_url);
    for (const [language, bytes] of Object.entries(languages)) {
      languageTotals.set(language, (languageTotals.get(language) || 0) + bytes);
    }
  }

  const nextReadme = replacePrivateTechSection(readme, renderSummary(
    languageTotals,
    repositoryLanguageCounts,
    frameworkCounts,
  ));

  if (nextReadme !== readme) {
    await writeFile(README_PATH, nextReadme);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Update private technology summary failed.';
  console.error(message);
  process.exitCode = 1;
});
