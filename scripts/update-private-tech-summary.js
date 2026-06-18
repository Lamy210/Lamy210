#!/usr/bin/env node

const fs = require("node:fs/promises");

const README_PATH = "README.md";
const START = "<!-- PRIVATE_TECH_START -->";
const END = "<!-- PRIVATE_TECH_END -->";
const TOKEN_ENV = "PRIVATE_REPO_STATS_TOKEN";
const GITHUB_API_VERSION = "2022-11-28";
const PRIVATE_REPOS_URL = "https://api.github.com/user/repos?visibility=private&per_page=100";

const token = process.env[TOKEN_ENV];

if (!token) {
  console.error(`${TOKEN_ENV} is not set.`);
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": GITHUB_API_VERSION,
};

async function githubFetch(url) {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}`);
  }

  return response.json();
}

async function fetchPrivateRepositories() {
  const repositories = [];
  let page = 1;

  while (true) {
    const data = await githubFetch(`${PRIVATE_REPOS_URL}&page=${page}`);

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    for (const repo of data) {
      if (repo && typeof repo.languages_url === "string") {
        repositories.push({
          languagesUrl: repo.languages_url,
        });
      }
    }

    page += 1;
  }

  return repositories;
}

async function aggregateLanguages(repositories) {
  const totals = new Map();

  for (const repository of repositories) {
    const languages = await githubFetch(repository.languagesUrl);

    if (!languages || typeof languages !== "object" || Array.isArray(languages)) {
      continue;
    }

    for (const [language, bytes] of Object.entries(languages)) {
      if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
        continue;
      }

      totals.set(language, (totals.get(language) || 0) + bytes);
    }
  }

  return totals;
}

function escapeMarkdownCell(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function toMarkdownTable(totals) {
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const totalBytes = entries.reduce((sum, [, bytes]) => sum + bytes, 0);

  if (entries.length === 0 || totalBytes === 0) {
    return ["| Language | Share |", "|---|---:|", "| No data | 0.0% |"].join("\n");
  }

  const rows = entries.map(([language, bytes]) => {
    const percentage = ((bytes / totalBytes) * 100).toFixed(1);
    return `| ${escapeMarkdownCell(language)} | ${percentage}% |`;
  });

  return ["| Language | Share |", "|---|---:|", ...rows].join("\n");
}

async function updateReadme(markdown) {
  const readme = await fs.readFile(README_PATH, "utf8");

  const startIndex = readme.indexOf(START);
  const endIndex = readme.indexOf(END);

  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    throw new Error("README private tech markers were not found.");
  }

  const before = readme.slice(0, startIndex + START.length);
  const after = readme.slice(endIndex);
  const nextReadme = `${before}\n\n${markdown}\n\n${after}`;

  await fs.writeFile(README_PATH, nextReadme);
}

async function main() {
  try {
    const repositories = await fetchPrivateRepositories();
    const totals = await aggregateLanguages(repositories);
    const markdown = toMarkdownTable(totals);

    await updateReadme(markdown);

    console.log("Private technology summary was updated safely.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unexpected error.");
    process.exit(1);
  }
}

main();
