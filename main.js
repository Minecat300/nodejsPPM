#!/usr/bin/env node

import fs from "fs";
import path from "path";
import os from "os";
import minimist from "minimist";
import simpleGit from "simple-git";
import ora from "ora";
import chalk from "chalk";
import { execSync } from "child_process";

import { expandHomeDir, getCurrentDir, setUpFile } from "./utils.js";
import { nginxSetup } from "./nginxHandeler.js";

const git = simpleGit();

function getRepoUrl(user, repoName, privateRepo = false) {
    repoName = repoName.replace(".git", "");
    const repoUrl = privateRepo ? `git@github.com:${user}/${repoName}.git` : `https://github.com/${user}/${repoName}.git`;
    return repoUrl;
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, force: true });
    }
}

async function cloneRepo(cloneDir, user, repoName, privateRepo) {
    const spinner = ora(`Cloning ${repoName}...`).start();
    try {
        const url = getRepoUrl(user, repoName, privateRepo);
        ensureDir(cloneDir);
        await git.clone(url, cloneDir);
        spinner.succeed(`Cloned ${repoName}!`);
    } catch (err) {
        spinner.fail("Failed to clone");
        console.error(chalk.red(err));
        return;
    }
}

function getPackageJson(dir) {
    const packagePath = path.join(dir, "package.json");
    if (!fs.existsSync(packagePath)) {
        console.error("No package.json was found! Can't continue.");
        return;
    }

    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return pkg;
}

function getAndCreateInstallPath(pkg, packageName) {
    const installPath = pkg.installPath
        ? path.resolve(process.cwd(), expandHomeDir(pkg.installPath))
        : path.join(process.cwd(), packageName);
    ensureDir(installPath);
    return installPath;
}

function moveFilesToInstallPath(installPath, tempDir) {
    const spinner = ora(`Moving files to: ${installPath}`).start();
    try {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            fs.renameSync(path.join(tempDir, file), path.join(installPath, file));
        }
        fs.rmdirSync(tempDir);
        spinner.succeed(`Moved files to : ${installPath}`);
    } catch (err) {
        spinner.fail("Failed to move files");
        console.error(chalk.red(err));
        return;
    }
}

function fixPermissions(installPath) {
    try{
        const username = process.env.SUDO_USER || os.userInfo().username;
        execSync(`chown -R ${username}:${username} "${installPath}"`);
        console.log(chalk.green(`Fixed file ownership to user ${username}`));
    } catch (err) {
        console.warn(chalk.yellow(`Could not fix ownership: ${err.message}`));
    }
}

function installDependancies(installPath) {
    const spinner = ora("Installing dependancies...").start();
    try {
        execSync("npm install", { cwd: installPath, stdio: "inherit" });
        spinner.succeed("Dependencies installed");
    } catch (err) {
        spinner.fail("npm install failed");
        console.error(chalk.red(err));
        return;
    }
}

function addPackageData(pkg, installpath) {
    try {
        const packageDataPath = path.join(getCurrentDir(), "packageData.json");
        const packageData = JSON.parse(fs.readFileSync(packageDataPath));
        packageData[pkg.name] = {
            installpath,
            version: pkg.version,
            description: pkg.description,
        }
        if (pkg.nginx) {
            packageData[pkg.name].nginx = pkg.nginx;
        }
        fs.writeFileSync(packageDataPath, JSON.stringify(packageData, null, 2));
    } catch (err) {
        console.error(chalk.red(err));
        return;
    }
}

async function installPackage(user, repoName, privateRepo) {
    repoName = repoName.replace(".git", "");
    const spinner = ora(`Installing package: ${repoName}`).start();
    const tempDir = path.join(getCurrentDir(), "tempPackages", repoName);
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    try {
        ensureDir(tempDir);
        await cloneRepo(tempDir, user, repoName, privateRepo);
        const pkg = getPackageJson(tempDir);
        const packageName = pkg.name || repoName;
        const installPath = getAndCreateInstallPath(pkg, packageName);
        moveFilesToInstallPath(installPath, tempDir);
        fixPermissions(installPath);
        installDependancies(installPath);
        addPackageData(pkg, installPath);
        spinner.succeed(`Installed package: ${packageName}`)
    } catch (err) {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        if (installPath) {
            if (fs.existsSync(installPath)) {
                fs.rmSync(installPath, { recursive: true, force: true });
            }
        }

        spinner.fail("Failed to install.");
        console.error(chalk.red(err));
        return;
    }
}

function setup() {
    const packageDataPath = path.join(getCurrentDir(), "packageData.json");
    if (fs.existsSync(packageDataPath)) return;
    nginxSetup();
    setUpFile(packageDataPath, JSON.stringify({
        "project-package-manager": {
            version: "1.0.0",
            installPath: getCurrentDir(),
            description: "Handles the packages for projects."
        }
    }, null, 2));
}

setup();
main();

async function main() {
    const args = minimist(process.argv.slice(2), {
        boolean: ['p', 'private']
    });

    const command = args._[0];

    if (command == "install") {
        const user = args._[1];
        const repoName = args._[2];
        const privateRepo = args.p || args.private;
        if (!user) {
            console.error(chalk.red("No user was provided"));
            return;
        }
        if (!repoName) {
            console.error(chalk.red("No repository name was provided"));
            return;
        }

        await installPackage(user, repoName, privateRepo);
        return;
    }
    console.log(chalk.cyan("no command provided"));
}