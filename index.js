const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");
const axios = require("axios");

const GITHUB_TOKEN = process.env.GITHUB_ACCESS_TOKEN;
const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};

async function fetchAllRepos(username) {
  let repos = [];
  let page = 1;
  const maxRetries = 3;

  while (true) {
    let retryCount = 0;
    while (retryCount < maxRetries) {
      try {
        const response = await axios.get(
          `https://api.github.com/users/${username}/repos?per_page=100&page=${page}`,
          { headers }
        );
        if (response.data.length === 0) return repos;
        repos = repos.concat(response.data);
        page++;
        break;
      } catch (error) {
        retryCount++;
        if (error.response?.status === 403) {
          console.error(
            `Rate limit exceeded. Please set GITHUB_TOKEN environment variable.`
          );
          console.error(
            `You can create a token at: https://github.com/settings/tokens`
          );
          console.error(`Then run: set GITHUB_TOKEN=your_token_here (Windows)`);
          console.error(`Or: export GITHUB_TOKEN=your_token_here (Linux/Mac)`);
          process.exit(1);
        }
        if (retryCount === maxRetries) {
          console.error(`Error fetching page ${page}:`, error.message);
          return repos;
        }
        console.log(`Retry ${retryCount}/${maxRetries} for page ${page}...`);
        await delay(1000 * retryCount);
      }
    }
  }
  return repos.filter((repo) => !repo.fork);
}

async function fetchBranches(username, repoName) {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${username}/${repoName}/branches`,
        { headers }
      );
      return response.data.map((branch) => branch.name);
    } catch (error) {
      retryCount++;
      if (error.response?.status === 403) {
        console.error(`Rate limit exceeded while fetching branches.`);
        return [];
      }
      if (retryCount === maxRetries) {
        console.error(
          `Error fetching branches for ${repoName}:`,
          error.message
        );
        return [];
      }
      console.log(`Retry ${retryCount}/${maxRetries} for fetching branches...`);
      await delay(1000 * retryCount);
    }
  }
  return [];
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cloneBranch(username, repo, branch, branchPath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (!fs.existsSync(branchPath)) {
        console.log(
          `Cloning branch ${branch} to ${branchPath}... (Attempt ${attempt}/${retries})`
        );
        const git = simpleGit();
        const cloneUrl = GITHUB_TOKEN
          ? `https://${GITHUB_TOKEN}@github.com/${username}/${repo.name}.git`
          : `https://github.com/${username}/${repo.name}.git`;

        await git.clone(cloneUrl, branchPath, [
          "--branch",
          branch,
          "--single-branch",
          "--depth",
          "1",
        ]);

        const stats = fs
          .readdirSync(branchPath)
          .filter((item) => item !== ".git").length;

        if (stats === 0) {
          console.log(`Branch ${branch} is empty, skipping...`);
          fs.rmSync(branchPath, { recursive: true, force: true });
          return false;
        }

        console.log(`Successfully cloned branch ${branch}`);

        const branchGit = simpleGit(branchPath);
        try {
          await branchGit.submoduleInit();
          await branchGit.submoduleUpdate([
            "--recursive",
            "--init",
            "--depth",
            "1",
          ]);
          console.log(`Updated submodules for branch ${branch}`);
        } catch (submoduleError) {
          if (!submoduleError.message.includes("no submodule mapping found")) {
            console.warn(
              `Warning: Could not update submodules for branch ${branch}:`,
              submoduleError.message
            );
          }
        }
        return true;
      } else {
        console.log(
          `Branch ${branch} already exists at ${branchPath}, skipping...`
        );
        return true;
      }
    } catch (error) {
      console.error(
        `Error cloning branch ${branch} (Attempt ${attempt}/${retries}):`,
        error.message
      );
      if (fs.existsSync(branchPath)) {
        fs.rmSync(branchPath, { recursive: true, force: true });
      }
      if (attempt < retries) {
        const delayTime = Math.pow(2, attempt - 1) * 500;
        console.log(`Retrying in ${delayTime / 1000} seconds...`);
        await delay(delayTime);
      } else {
        return false;
      }
    }
  }
  return false;
}

async function cloneRepo(username, repo, outputDir) {
  const repoPath = path.join(outputDir, repo.name);
  try {
    console.log(`\nProcessing repository: ${repo.name}`);

    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true });
    }

    console.log("Fetching branch information from GitHub API...");
    const branches = await fetchBranches(username, repo.name);
    console.log(`Found ${branches.length} branches in ${repo.name}`);

    if (branches.length === 0) {
      console.log("No branches found, skipping repository");
      return { success: false, successfulBranches: 0, failedBranches: 0 };
    }

    let successfulBranches = 0;
    let failedBranches = 0;

    for (const branch of branches) {
      const branchDirName = branch.replace("/", "-");
      const branchPath = path.join(repoPath, branchDirName);

      const success = await cloneBranch(username, repo, branch, branchPath);
      if (success) {
        successfulBranches++;
      } else {
        failedBranches++;
      }

      await delay(500);
    }

    console.log(`\nRepository ${repo.name} summary:`);
    console.log(`Successfully cloned branches: ${successfulBranches}`);
    console.log(`Failed branches: ${failedBranches}`);

    if (successfulBranches === 0) {
      fs.rmSync(repoPath, { recursive: true, force: true });
      console.log(`Removed empty repository directory: ${repo.name}`);
    }

    return {
      success: successfulBranches > 0,
      successfulBranches,
      failedBranches,
    };
  } catch (error) {
    console.error(`Error processing repository ${repo.name}:`, error.message);
    return { success: false, successfulBranches: 0, failedBranches: 1 };
  }
}

async function cloneRootRepo(username, repo, outputDir) {
  const repoPath = path.join(outputDir, repo.name);
  try {
    console.log(`\nProcessing repository: ${repo.name}`);

    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true });
    }

    console.log(`Cloning root repository ${repo.name}...`);
    const git = simpleGit();
    const cloneUrl = GITHUB_TOKEN
      ? `https://${GITHUB_TOKEN}@github.com/${username}/${repo.name}.git`
      : `https://github.com/${username}/${repo.name}.git`;

    await git.clone(cloneUrl, repoPath, ["--depth", "1"]);

    console.log(`Successfully cloned root repository ${repo.name}`);
    return { success: true };
  } catch (error) {
    console.error(`Error processing repository ${repo.name}:`, error.message);
    return { success: false };
  }
}

(async function () {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      console.error("Please provide a GitHub username.");
      process.exit(1);
    }

    if (!GITHUB_TOKEN) {
      console.warn(
        "\nWarning: GITHUB_TOKEN not set. You may encounter rate limits."
      );
      console.warn("To set the token:");
      console.warn("1. Create a token at: https://github.com/settings/tokens");
      console.warn("2. Then run: set GITHUB_TOKEN=your_token_here (Windows)");
      console.warn("   Or: export GITHUB_TOKEN=your_token_here (Linux/Mac)\n");
    }

    const username = args[0];
    const fetchBranchesOption = args.includes("--fetch-branches");
    const outputDir = path.join(__dirname, "repositories", username);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Fetching repositories for user: ${username}...`);
    const repos = await fetchAllRepos(username);

    if (repos.length === 0) {
      console.log("No public repositories found.");
      return;
    }

    console.log(
      `Found ${repos.length} repositories. Starting cloning...`
    );

    let totalSuccessfulRepos = 0;
    let totalFailedRepos = 0;
    let totalSuccessfulBranches = 0;
    let totalFailedBranches = 0;

    for (const repo of repos) {
      let result;
      if (fetchBranchesOption) {
        result = await cloneRepo(username, repo, outputDir);
        if (result.success) {
          totalSuccessfulBranches += result.successfulBranches;
          totalFailedBranches += result.failedBranches;
        }
      } else {
        result = await cloneRootRepo(username, repo, outputDir);
      }

      if (result.success) {
        totalSuccessfulRepos++;
      } else {
        totalFailedRepos++;
      }

      await delay(1000);
    }

    console.log("\nFinal Summary:");
    console.log(`Successfully processed repositories: ${totalSuccessfulRepos}`);
    console.log(`Failed repositories: ${totalFailedRepos}`);
    if (fetchBranchesOption) {
      console.log(`Total successful branches: ${totalSuccessfulBranches}`);
      console.log(`Total failed branches: ${totalFailedBranches}`);
    }
  } catch (error) {
    console.error("Error:", error.message || error);
    process.exit(1);
  }
})();
