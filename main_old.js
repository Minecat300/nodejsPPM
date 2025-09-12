#!/usr/bin/env node

import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import simpleGit from "simple-git";
import chalk from "chalk";
import ora from "ora";

const [, , command, repoUrl] = process.argv;

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
    for (const file of files) {
        fs.renameSync(path.join(tempDir, file), path.join(installPath, file));
    }
    fs.rmdirSync(tempDir);

    try {
        const username = process.env.SUDO_USER || os.userInfo().username;
        execSync(`chown -R ${username}:${username} "${installPath}"`);
        console.log(chalk.green(`Fixed file ownership to user ${username}`));
    } catch (err) {
        console.warn(chalk.yellow(`Could not fix ownership: ${err.message}`));
    }

    console.log(chalk.cyan(`Moved repo to ${installPath}`));

    spinner.start("Installing dependencies...");
    try {
        execSync("npm install", { cwd: installPath, stdio: "inherit" });
        spinner.succeed("Dependencies installed");
    } catch (err) {
        spinner.fail("npm install failed");
        console.error(chalk.red(err));
    }

    if (pkg.nginxConfig) {
        addToNginxList(pkg.nginxConfig, repoName);
        updateNginxConfig();
    }

    setupPm2AutoStart(path.join(pkg.installPath, pkg.main), repoName);
}

function addToNginxList(config, repoName) {
    const configPath = path.join("/home/minecat300/", "packageManager/nginxConfig.json");
    const nginxConfigJson = JSON.parse(fs.readFileSync(configPath, "utf8"));
    nginxConfigJson[repoName] = config;
    fs.writeFileSync(configPath, JSON.stringify(nginxConfigJson, null, 2));
}



function setupPm2AutoStart(scriptPath, appName) {
    try {
        const user = process.env.SUDO_USER || process.env.USER;
        const home = `/home/${user}`;

        execSync(`sudo -u ${user} pm2 start ${scriptPath} --name ${appName}`, { stdio: "inherit" });
        execSync(`sudo -u ${user} pm2 save`, { stdio: "inherit" });

        const startupCmd = execSync(`pm2 startup systemd -u ${user} --hp ${home}`, { encoding: "utf8" });
        console.log("Run this command to enable PM2 startup at boot:");
        const sudoCmdMatch = startupCmd.match(/sudo .*/);
        if (sudoCmdMatch) {
            console.log(sudoCmdMatch[0]);
        } else {
            console.log("Couldn't find the pm2 startup sudo command.");
        }
    } catch (err) {
        console.error("Error setting up PM2:", err);
    }
}

if (command === "install" && repoUrl) {
    installRepo(repoUrl);
} else {
    console.log(
        chalk.cyan("Usage: ppm install <github-repo-url>")
    );
}