#!/usr/bin/env node

import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import simpleGit from "simple-git";
import chalk from "chalk";
import ora from "ora";

const [, , command, repoUrl] = process.argv;

function expandHomeDir(p) {
    if (!p) return p;
    if (p.startsWith("~")) {
        return path.join(os.homedir(), p.slice(1));
    }
    return p;
}

async function installRepo(repoUrl) {
    const repoName = repoUrl.split("/").pop().replace(".git", "");
    const tempDir = path.join(os.homedir(), "packageManager/tempInstalls", repoName);

    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    const spinner = ora(`Cloning ${repoName}...`).start();
    try {
        await simpleGit().clone(repoUrl, tempDir);
        spinner.succeed(`Cloned ${repoName}`);
    } catch (err) {
        spinner.fail("Failed to clone");
        console.error(chalk.red(err));
        return;
    }

    const packagePath = path.join(tempDir, "package.json");
    if (!fs.existsSync(packagePath)) {
        console.log(chalk.red("No package.json found! Can't continue."));
        return;
    }

    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const installPath = pkg.installPath
        ? path.resolve(process.cwd(), expandHomeDir(pkg.installPath))
        : path.join(process.cwd(), repoName);

    if (!fs.existsSync(installPath)) {
        fs.mkdirSync(installPath, { recursive: true });
        console.log(chalk.green(`Created directory: ${installPath}`));
    }

    const files = fs.readdirSync(tempDir);
    for (const file in files) {
        fs.renameSync(path.join(tempDir, file), path.join(installPath, file));
    }
    fs.rmdirSync(tempDir);
    console.log(chalk.cyan(`Moved repo to ${installPath}`));

    spinner.start("Installing dependencies...");
    try {
        execSync("npm install", { cwd: targetDir, stdio: "inherit" });
        spinner.succeed("Dependencies installed");
    } catch (err) {
        spinner.fail("npm install failed");
        console.error(chalk.red(err));
    }
}

if (command === "install" && repoUrl) {
    installRepo(repoUrl);
} else {
    console.log(
        chalk.cyan("Usage: ppm install <github-repo-url>")
    );
}