import fs from "fs";
import path from "path";
import os from "os";
import minimist from "minimist";
import simpleGit from "simple-git";
import ora from "ora";
import chalk from "chalk";
import { execSync } from "child_process";

import { expandHomeDir, getCurrentDir, setUpFile, printTable, safeRemove, ensureDir, isDirEmpty } from "./utils.js";
import { nginxSetup } from "./nginxHandeler.js";
import { cloneRepo, gitPullRepo } from "./gitHandeler.js";

chalk.orange = chalk.rgb(255, 165, 0);

function getPackageJson(dir) {
    const packagePath = path.join(dir, "package.json");
    if (!fs.existsSync(packagePath)) {
        console.error(chalk.orange("No package.json was found! Can't continue."));
        return;
    }

    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return pkg;
}

function getAndCreateInstallPath(pkg, packageName, forceInstall = false) {
    try {
        let installPath = pkg.installPath
            ? path.resolve(process.cwd(), expandHomeDir(pkg.installPath))
            : path.join(process.cwd(), packageName);
        if (!isDirEmpty(installPath) && forceInstall) {
            safeRemove(installPath);
        }
        if (!isDirEmpty(installPath)) {
            installPath = undefined;
            throw new Error("Install path not empty");
        }
        ensureDir(installPath);
        return installPath;
    } catch (err) {
        console.error(chalk.orange(err));
        throw err;
    }
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
        console.error(chalk.orange(err));
        throw err;
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
        console.error(chalk.orange(err));
        throw err;
    }
}

function addPackageData(pkg, installPath) {
    try {
        const packageDataPath = path.join(getCurrentDir(), "packageData.json");
        const packageData = JSON.parse(fs.readFileSync(packageDataPath));
        packageData[pkg.name] = {
            installPath,
            version: pkg.version,
            description: pkg.description,
        }
        if (pkg.nginx) {
            packageData[pkg.name].nginx = pkg.nginx;
        }
        fs.writeFileSync(packageDataPath, JSON.stringify(packageData, null, 2));
    } catch (err) {
        console.error(chalk.orange(err));
        throw err;
    }
}

function removePackageData(packageName) {
    try {
        const packageDataPath = path.join(getCurrentDir(), "packageData.json");
        const packageData = JSON.parse(fs.readFileSync(packageDataPath));
        delete packageData[packageName];
        fs.writeFileSync(packageDataPath, JSON.stringify(packageData, null, 2));
    } catch (err) {
        console.error(chalk.orange(err));
        throw err;
    }
}

async function installPackage(user, repoName, privateRepo, forceInstall) {
    repoName = repoName.replace(".git", "");
    const spinner = ora(`Installing package: ${repoName}`).start();
    const tempDir = path.join(getCurrentDir(), "tempPackages", repoName);
    safeRemove(tempDir);

    let installPath;

    try {
        ensureDir(tempDir);
        await cloneRepo(tempDir, user, repoName, privateRepo);
        const pkg = getPackageJson(tempDir);
        const packageName = pkg.name || repoName;
        installPath = getAndCreateInstallPath(pkg, packageName, forceInstall);
        moveFilesToInstallPath(installPath, tempDir);
        fixPermissions(installPath);
        installDependancies(installPath);
        addPackageData(pkg, installPath);
        spinner.succeed(`Installed package: ${packageName}`)
    } catch (err) {
        safeRemove(tempDir);

        if (installPath) {
            safeRemove(installPath);
        }

        spinner.fail("Failed to install.");
        console.error(err);
        throw err;
    }
}

function uninstallPackage(packageName) {
    const packageDataPath = path.join(getCurrentDir(), "packageData.json");
    const packageData = JSON.parse(fs.readFileSync(packageDataPath));

    const pkg = packageData[packageName];
    if (!pkg) {
        console.error(chalk.orange(`Package ${packageName} was not found`));
        return;
    }

    const spinner = ora(`Uninstalling package: ${packageName}...`).start();
    try {
        safeRemove(pkg.installPath);
        removePackageData(packageName);
        spinner.succeed(`Uninstalled package: ${packageName}`);
    } catch (err) {
        spinner.fail("Failed to uninstall.");
        console.error(err);
        throw err;
    }
}

async function updatePackage(packageName) {
    const packageDataPath = path.join(getCurrentDir(), "packageData.json");
    const packageData = JSON.parse(fs.readFileSync(packageDataPath));

    const pkg = packageData[packageName];
    if (!pkg) {
        console.error(chalk.orange(`Package ${packageName} was not found`));
        return;
    }

    const spinner = ora(`Updating package: ${packageName}...`).start();
    try {
        await gitPullRepo(pkg.installPath);
        installDependancies(pkg.installPath);
        removePackageData(packageName);
        const pkgJson = getPackageJson(pkg.installPath);
        addPackageData(pkgJson, pkg.installPath);
        console.log(chalk.green(`Version ${pkg.version} -> ${pkgJson.version}`));
        spinner.succeed(`Updated package: ${packageName}`);
    } catch (err) {
        spinner.fail("Failed to update.");
        console.error(err);
        throw err;
    }
}

export function setup() {
    const packageDataPath = path.join(getCurrentDir(), "packageData.json");
    if (fs.existsSync(packageDataPath)) return;
    const pkg = getPackageJson(getCurrentDir());
    nginxSetup();
    setUpFile(packageDataPath, JSON.stringify({
        [pkg.name]: {
            version: pkg.version,
            installPath: getCurrentDir(),
            description: pkg.description
        }
    }, null, 2));
}

export async function main() {
    const args = minimist(process.argv.slice(2), {
        boolean: ['p', 'private', 'f', 'force']
    });

    const packageDataPath = path.join(getCurrentDir(), "packageData.json");

    const command = args._[0];

    if (command == "install") {
        const user = args._[1];
        const repoName = args._[2];
        const privateRepo = args.p || args.private;
        const forceInstall = args.f || args.force;
        if (!user) {
            console.error(chalk.orange("No user was provided"));
            return;
        }
        if (!repoName) {
            console.error(chalk.orange("No repository name was provided"));
            return;
        }

        await installPackage(user, repoName, privateRepo, forceInstall);
        return;
    }
    if (command == "uninstall") {
        const packageName = args._[1];
        if (!packageName) {
            console.error(chalk.orange("No package name was provided"));
            return;
        }

        uninstallPackage(packageName);
        return;
    }
    if (command == "update") {
        const packageName = args._[1];
        if (!packageName) {
            console.error(chalk.orange("No package name was provided"));
            return;
        }

        updatePackage(packageName);
        return;
    }
    if (command == "list") {
        const packageData = JSON.parse(fs.readFileSync(packageDataPath));
        printTable(packageData, ["version", "description", "installPath"], 40);
        return;
    }
    if (command == "help" || command == "h" || command == "?" || !command) {
        console.log(chalk.cyan("Commands: "));
        console.log("sudo ppm", chalk.cyan("install"), "<username/orginisation> <Repository name> (--private, -p for private repos, --force, -f for force install)");
        console.log("sudo ppm", chalk.cyan("uninstall"), "<Package name>");
        console.log("sudo ppm", chalk.cyan("update"), "<Package name>");
        console.log("sudo ppm", chalk.cyan("list"));
        return;
    }

}