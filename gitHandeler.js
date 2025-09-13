import { spawn } from "child_process";
import simpleGit from "simple-git";
import ora from "ora";
import chalk from "chalk";

import { expandHomeDir, getCurrentDir, setUpFile, printTable, safeRemove, ensureDir } from "./utils.js";

chalk.orange = chalk.rgb(255, 165, 0);

function getRepoUrl(user, repoName, privateRepo = false) {
    repoName = repoName.replace(".git", "");
    const repoUrl = privateRepo ? `git@github.com:${user}/${repoName}.git` : `https://github.com/${user}/${repoName}.git`;
    return repoUrl;
}

export async function cloneRepo(cloneDir, user, repoName, privateRepo) {
    const spinner = ora(`Cloning ${repoName}...`).start();
    const url = getRepoUrl(user, repoName, privateRepo);

    try {
        await new Promise((resolve, reject) => {
            const gitProcess = spawn("git", ["clone", url, cloneDir], { stdio: "pipe" });
            let stderr = "";

            gitProcess.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            // Timeout after 30 seconds
            const timeout = setTimeout(() => {
                gitProcess.kill();
                reject(new Error("Clone timed out"));
            }, 30000);

            gitProcess.on("exit", (code) => {
                clearTimeout(timeout);
                if (code === 0) resolve();
                else reject(new Error(stderr || `Git clone failed with exit code ${code}`));
            });

            gitProcess.on("error", (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        spinner.succeed(`Cloned ${repoName}!`);
    } catch (err) {
        spinner.fail(`Failed to clone ${repoName}`);
        console.error(chalk.orange(err.message));
        throw err;
    }
}

export async function getRepoUrlFromPath(repoPath) {
    const git = simpleGit(repoPath);
    try {
        const remotes = await git.getRemotes(true);
        const originRemote = remotes.find(r => r.name === "origin");
        if (originRemote) {
            return originRemote.refs.fetch;
        } else {
            console.log("No origin remote found!");
            return null;
        }
    } catch (err) {
        console.error(chalk.orange("Failed to get remote URL:"), chalk.orange(err));
        return null;
    }
}

export async function gitPullRepo(path) {
    const repoUrl = await getRepoUrlFromPath(path) ?? "Not found";
    const git = simpleGit(path);
    const spinner = ora(`Pulling from ${repoUrl}`).start();
    try {
        await git.pull();
        spinner.succeed(`Pulled from ${repoUrl}`);
    } catch (err) {
        spinner.fail(`Failed to pull from ${repoUrl}`);
        console.error(chalk.orange(err));
        return;
    }
}