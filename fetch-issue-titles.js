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


class GitHubFetcher {

    owner;

    repo;

    authKey;

    constructor(owner, repo, authKey) {
        this.owner = owner;
        this.repo = repo;
        this.authKey = authKey;
    }

}


/**
 * Fetch issue, pull request or discussion titles.
 * Cursor-based fetching without parallelization.
 */
class GraphQLTitleFetcher extends GitHubFetcher {

    perPage = 100;

    query = itemType => `
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

    /**
     * @param {int} limit
     * @param {string} itemType
     * @returns {Promise<string[]>}
     */
    async fetch(limit, itemType) {
        const itemTitles = [];

        let hasNextPage = true;
        let cursor = null;

        let page = 1;
        let totalPages = Math.ceil(limit / this.perPage);

        while (hasNextPage) {
            process.stderr.write(`Fetching ${itemType} page ${page}/${totalPages}\r`);

            const response = await graphql({
                query: this.query(itemType),
                owner,
                repo,
                perPage: this.perPage,
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

    constructor(owner, repo, authKey) {
        super(owner, repo, authKey)
    }

}

/**
 * Fetch issue and pull request titles.
 * Requests are sent in parallel for speed-up.
 */
class RESTTitleFetcher extends GitHubFetcher {

    perPage = 100;

    constructor(owner, repo, authKey) {
        super(owner, repo, authKey);

        this.octokit = new Octokit({
            auth: this.authKey,
        });
    }

    /**
     * @param {int} limit
     * @returns {Promise<string[]>}
     */
    async fetch(limit) {
        const titles = [];

        const totalPages = Math.ceil(limit / this.perPage);
        const pageNrList = Array.from({length: totalPages}, (_, i) => i + 1);

        const responses = await Promise.allSettled(pageNrList.map((page) => {
            process.stderr.write(`Fetching issues/pull requests page ${page}/${totalPages}\r`);

            return this.octokit.issues.listForRepo({
                owner: this.owner,
                repo: this.repo,
                filter: "all",
                state: "all",
                per_page: this.perPage,
                page,
            });
        }));

        responses.forEach((response) => {
            if (response.status === 'fulfilled') {
                const fetchedTitles = response.value?.data.map(issue => `${issue.number},${issue.title}`);
                titles.push(...fetchedTitles);
            } else {
                console.error('Error:', response.reason);
            }
        });

        return titles;
    }

}

class ItemCountFetcher extends GitHubFetcher {

    query = `
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

    constructor(owner, repo, authKey) {
        super(owner, repo, authKey);
    }

    /**
     * @returns {Promise<{discussions: int, pullRequests: int, issues: int}>}
     */
    async fetch() {
        try {
            const response = await graphql({
                query: this.query,
                owner: this.owner,
                repo: this.repo,
                headers: {
                    authorization: `token ${this.authKey}`
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
    }

}


const itemCounts = await new ItemCountFetcher(owner, repo, authKey).fetch();
const totalIssues = itemCounts["issues"] + itemCounts["pullRequests"];

const titles = [
    ...await new RESTTitleFetcher(owner, repo, authKey).fetch(totalIssues),
    ...await new GraphQLTitleFetcher(owner, repo, authKey).fetch(itemCounts["discussions"], "discussions"),
];


fs.rmSync(outputFile, {force: true});

titles.forEach((itemTitle) => {
    fs.appendFileSync(outputFile, `${itemTitle}\n`, 'utf8');
});

console.log(`Written ${titles.length} titles to ${outputFile}`);
