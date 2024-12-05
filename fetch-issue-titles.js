import { Octokit } from '@octokit/rest';
import fs from 'fs';


if (process.argv.length < 6) {
  console.log('Usage: node ' + process.argv[1] + ' GITHUB_REPO_OWNER GITHUB_REPO_NAME GITHUB_KEY_FILE OUTPUT_PATH');
  process.exit(1);
}

const owner = process.argv[2];
const repo = process.argv[3];
const keyFile = process.argv[4];
const outputFile = process.argv[5];

const authKey = fs.readFileSync(keyFile, 'utf8');

const nrOfIssues = 4000;
const nrOfDiscussions = 500;

const octokit = new Octokit({
  auth: authKey,
});


async function fetchIssueTitles(owner, repo) {
  let issueCounter = 0;

  const issuesPerPage = 100;
  const nrPages = nrOfIssues / issuesPerPage;

  const pageNrList = [];

  for (let pageNr = 1; pageNr < nrPages; pageNr++) {
    pageNrList.push(pageNr);
  }

  const responses = await Promise.allSettled(pageNrList.map((pageNr) => {
    return octokit.issues.listForRepo({
      owner,
      repo,
      filter: "all",
      state: "all",
      per_page: issuesPerPage,
      page: pageNr,
    });
  }));

  fs.rmSync(outputFile, { force: true });

  responses.forEach((response) => {
    if (response.status === 'fulfilled') {
      const issues = response.value?.data ?? [];

      issues.forEach((issue) => {
        const issueData = `${issue.number},${issue.title}\n`;
        fs.appendFileSync(outputFile, issueData, 'utf8');
        issueCounter++;
      });
    } else {
      console.error('Error:', response.reason);
    }
  });

  console.log(`Written ${issueCounter} issues to ${outputFile}`);
}

/*
async function fetchDiscussionTitles(owner) {
  let issueCounter = 0;

  const issuesPerPage = 100;
  const nrPages = nrOfDiscussions / issuesPerPage;

  const pageNrList = [];

  for (let pageNr = 1; pageNr < nrPages; pageNr++) {
    pageNrList.push(pageNr);
  }

  const responses = await Promise.allSettled(pageNrList.map((pageNr) => {
    return octokit.rest.teams.listDiscussionsInOrg({
      org: owner,
      per_page: issuesPerPage,
      page: pageNr,
    });
  }));

  fs.rmSync(outputFile, { force: true });

  responses.forEach((response) => {
    if (response.status === 'fulfilled') {
      const issues = response.value?.data ?? [];

      issues.forEach((issue) => {
        const issueData = `${issue.number},${issue.title}\n`;
        fs.appendFileSync(outputFile, issueData, 'utf8');
        issueCounter++;
      });
    } else {
      console.error('Error:', response.reason);
    }
  });

  console.log(`Written ${issueCounter} issues to ${outputFile}`);

}
 */


fetchIssueTitles(owner, repo);
// fetchDiscussionTitles(owner);
