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
    const tempDir = path.join(process.cwd(), repoName);

    const spinner = ora(`Cloning ${repoName}...`).start();
    try {
        await simpleGit().clone(repoUrl);
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
        ? path.resolve(process.cwd(), pkg.installPath)
        : tempDir;

    if (!fs.existsSync(installPath)) {
        fs.mkdirSync(installPath, { recursive: true });
        console.log(chalk.green(`Created directory: ${installPath}`));
    }

    if (installPath !== tempDir) {
        const files = fs.readdirSync(tempDir);
        for (const file in files) {
            fs.renameSync(path.join(tempDir, file), path.join(installPath, file));
        }
        fs.rmdirSync(tempDir);
        console.log(chalk.cyan(`Moved repo to ${installPath}`));
    }

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