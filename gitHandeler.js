import { spawn } from "child_process";
import simpleGit from "simple-git";
import ora from "ora";
import chalk from "chalk";

import { expandHomeDir, getCurrentDir, setUpFile, printTable, safeRemove, ensureDir } from "./utils.js";

chalk.orange = chalk.rgb(255, 81, 0);
chalk.trueCyan = chalk.rgb(39, 185, 232);

function getRepoUrl(user, repoName, privateRepo = false) {
    repoName = repoName.replace(".git", "");
    const repoUrl = privateRepo ? `git@github.com:${user}/${repoName}.git` : `https://github.com/${user}/${repoName}.git`;
    return repoUrl;
}

export async function cloneRepo(spinner, cloneDir, user, repoName, branch = "main", privateRepo = false) {
    spinner.text = `Cloning ${repoName}...`;
    const url = getRepoUrl(user, repoName, privateRepo);

    try {
        await new Promise((resolve, reject) => {
            const gitProcess = spawn("git", ["clone", "-b", branch, "--single-branch", url, cloneDir], { stdio: "pipe" });
            let stderr = "";

            gitProcess.stderr.on("data", (data) => {
                stderr += data.toString();
            });

            // Timeout after 30 seconds
            const timeout = setTimeout(() => {
                gitProcess.kill();
                reject(chalk.orange("Clone timed out"));
            }, 30000);

            gitProcess.on("exit", (code) => {
                clearTimeout(timeout);
                if (code === 0) resolve();
                else reject(chalk.orange(stderr || `Git clone failed with exit code ${code}`));
            });

            gitProcess.on("error", (err) => {
                clearTimeout(timeout);
                reject(chalk.orange(err));
            });
        });

        spinner.text = `Cloned ${repoName}!`;
    } catch (err) {
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
        throw err;
    }
}

export async function gitPullRepo(spinner, path) {
    const repoUrl = await getRepoUrlFromPath(path) ?? "Not found";
    const git = simpleGit(path);
    spinner.text = `Pulling from ${repoUrl}`;
    try {
        await git.pull();
        spinner.text = `Pulled from ${repoUrl}`;
    } catch (err) {
        throw err;
    }
}