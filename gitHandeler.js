import { spawn } from "child_process";
import simpleGit from "simple-git";
import ora from "ora";
import chalk from "chalk";
import os from "os";

import { expandHomeDir, getCurrentDir, setUpFile, printTable, safeRemove, ensureDir } from "./utils.js";

chalk.orange = chalk.rgb(255, 81, 0);
chalk.trueCyan = chalk.rgb(39, 185, 232);

// Detect the original non-root user
const originalUser = process.env.SUDO_USER || process.env.USER;
const userInfo = os.userInfo({ username: originalUser });
const UID = userInfo.uid;
const GID = userInfo.gid;

function getRepoUrl(user, repoName, privateRepo = false) {
    repoName = repoName.replace(".git", "");
    return privateRepo
        ? `git@github.com:${user}/${repoName}.git`
        : `https://github.com/${user}/${repoName}.git`;
}

export async function cloneRepo(spinner, cloneDir, user, repoName, branch = "main", privateRepo = false) {
    spinner.text = `Cloning ${repoName}...`;
    const url = getRepoUrl(user, repoName, privateRepo);

    try {
        await new Promise((resolve, reject) => {
            const gitProcess = spawn("git", ["clone", "-b", branch, "--single-branch", url, cloneDir], {
                stdio: "pipe",
                uid: UID,
                gid: GID,
            });

            let stderr = "";

            gitProcess.stderr.on("data", (data) => {
                stderr += data.toString();
            });

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
        return originRemote ? originRemote.refs.fetch : null;
    } catch (err) {
        throw err;
    }
}

export async function gitPullRepo(spinner, repoPath) {
    const repoUrl = (await getRepoUrlFromPath(repoPath)) ?? "Not found";
    const git = simpleGit(repoPath);

    spinner.text = `Force pulling from ${repoUrl}`;
    try {
        // Step 1: Save executable permissions
        const execFiles = [];
        function checkExecutable(filePath) {
            try {
                const stat = fs.statSync(filePath);
                if (stat.isFile() && (stat.mode & 0o111)) {
                    execFiles.push(filePath);
                }
            } catch {}
        }

        function walkDir(dir) {
            for (const f of fs.readdirSync(dir)) {
                const fullPath = path.join(dir, f);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) walkDir(fullPath);
                else checkExecutable(fullPath);
            }
        }
        walkDir(repoPath);

        // Step 2: Fetch updates
        await git.fetch();

        // Step 3: Force reset
        const status = await git.status();
        const branch = status.current;
        await git.reset(["--hard", `origin/${branch}`]);

        // Step 4: Restore executable permissions
        for (const file of execFiles) {
            fs.chmodSync(file, fs.statSync(file).mode | 0o111);
        }

        spinner.text = `Force pulled from ${repoUrl}`;
    } catch (err) {
        throw err;
    }
}
