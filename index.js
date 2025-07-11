#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const simpleGit = require("simple-git");
const ora = require("ora");
const chalk = require("chalk");

const [, , command, repoUrl] = process.argv;

async function installRepo(repoUrl) {
    const repoName = repoUrl.split("/").pop().replace(".git", "");
    const targetDir = path.join(process.cwd(), repoName);

    const spinner = ora(`Cloning ${repoName}...`).start();
    try {
        await simpleGit().clone(repoUrl);
        spinner.succeed(`Cloned ${repoName}`);
    } catch (err) {
        spinner.fail("Failed to clone");
        console.error(chalk.red(err));
        return;
    }

    if (fs.existsSync(path.join(targetDir, "package.json"))) {
        spinner.start("Installing dependencies...");
        try {
            execSync("npm install", { cwd: targetDir, stdio: "inherit" });
            spinner.succeed("Dependencies installed");
        } catch (err) {
            spinner.fail("npm install failed");
            console.error(chalk.red(err));
        }
    } else {
        console.log(chalk.yellow("No package.json found - skipping install"));
    }
}

if (command === "install" && repoUrl) {
    installRepo(repoUrl);
} else {
    console.log(
        chalk.cyan("Usage: ppm install <github-repo-url>")
    );
}