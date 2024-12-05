#!/usr/bin/env node
import {Octokit} from '@octokit/rest';
import {graphql} from "@octokit/graphql";
import fs from 'fs';


if (process.argv.length < 6) {
    console.log('Usage: node ' + process.argv[1] + ' <user-or-organisation> <repo> <personal-access-token-file> <output-file>');
    process.exit(1);
}

const owner = process.argv[2];
const repo = process.argv[3];
const keyFile = process.argv[4];
const outputFile = process.argv[5];

const authKey = fs.readFileSync(keyFile, 'utf8');


/**
 *
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<{discussions: int, pullRequests: int, issues: int}>}
 */
const fetchRepoStats = async (owner, repo) => {
    const query = `
    query ($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        issues {
          totalCount
        }
        pullRequests {
          totalCount
        }
        discussions {
          totalCount
        }
      }
    }
  `;

    try {
        const response = await graphql({
            query,
            owner,
            repo,
            headers: {
                authorization: `token ${authKey}`
            }
        });

        return {
            "issues": response.repository.issues.totalCount,
            "pullRequests": response.repository.pullRequests.totalCount,
            "discussions": response.repository.discussions.totalCount,
        };
    } catch (error) {
        console.error("Error fetching repository stats:", error);
    }
};

const issuesPerPage = 100;

const octokit = new Octokit({
    auth: authKey,
});

async function fetchIssueTitles(owner, repo, totalIssues) {
    const itemTitles = [];

    const totalPages = Math.ceil(totalIssues / issuesPerPage);
    const pageNrList = Array.from({length: totalPages}, (_, i) => i + 1);

    const responses = await Promise.allSettled(pageNrList.map((page) => {
        process.stdout.write(`Fetching issues/pull requests page ${page}/${totalPages}\r`);

        return octokit.issues.listForRepo({
            owner,
            repo,
            filter: "all",
            state: "all",
            per_page: issuesPerPage,
            page,
        });
    }));

    responses.forEach((response) => {
        if (response.status === 'fulfilled') {
            const fetchedTitles = response.value?.data.map(issue => `${issue.number},${issue.title}`);
            itemTitles.push(...fetchedTitles);
        } else {
            console.error('Error:', response.reason);
        }
    });

    return itemTitles;
}

const perPage = 100;

const query = itemType => `
    query($owner: String!, $repo: String!, $perPage: Int, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        ${itemType}(first: $perPage, after: $cursor) {
          edges {
            node {
              title
              number
            }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }
    }
  `;

async function fetchItemTitles(owner, repo, itemType, totalCount) {
    const itemTitles = [];

    let hasNextPage = true;
    let cursor = null;

    let page = 1;
    let totalPages = Math.ceil(totalCount / perPage);

    while (hasNextPage) {
        process.stdout.write(`Fetching ${itemType} page ${page}/${totalPages}\r`);
        const response = await graphql({
            query: query(itemType),
            owner,
            repo,
            perPage,
            cursor,
            headers: {
                authorization: `token ${authKey}`
            }
        });

        if (hasNextPage) {
            const fetchedTitles = response.repository[itemType].edges.map(edge => `${edge.node.number},${edge.node.title}`);
            itemTitles.push(...fetchedTitles);
            hasNextPage = response.repository[itemType].pageInfo.hasNextPage;
            cursor = response.repository[itemType].pageInfo.endCursor;
        }

        page++;
    }

    return itemTitles;
}

async function fetchTitles(owner, repo, repoStats) {
    const titles = {};

    for (const itemType in repoStats) {
        // for performance reasons only discussions with graphql
        if (itemType === "discussions") {
            titles[itemType] = await fetchItemTitles(owner, repo, itemType, repoStats[itemType]);
        }
    }

    // fetch issues and pull requests via REST
    const totalIssues = repoStats["issues"] + repoStats["pullRequests"];
    titles["issues"] = await fetchIssueTitles(owner, repo, totalIssues);

    return titles;
}

const repoStats = await fetchRepoStats(owner, repo);
const titles = await fetchTitles(owner, repo, repoStats)

fs.rmSync(outputFile, {force: true});

for (const [itemType, itemTitles] of Object.entries(titles)) {
    itemTitles.forEach((itemTitle) => {
            fs.appendFileSync(outputFile, `${itemTitle}\n`, 'utf8');
        }
    );
}

console.log(`Written ${titles.issues.length} issue/pull request and ${titles.discussions.length} discussion titles to ${outputFile}`);
