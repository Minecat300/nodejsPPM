import fs from "fs";
import path from "path";
import os from "os";
import minimist from "minimist";
import ora from "ora";
import chalk from "chalk";
import { execSync, exec } from "child_process";

import { expandHomeDir, getCurrentDir, setUpFile, printTable, safeRemove, ensureDir, isDirEmpty, prependToKeyValue, stringToArray, getUser, getHomeDir } from "./utils.js";
import { nginxSetup, addServiceFromPackage, removeService, removeServer, addNewService, addNewServer, updateNginxConfig } from "./nginxHandeler.js";
import { cloneRepo, gitPullRepo } from "./gitHandeler.js";

chalk.orange = chalk.rgb(255, 81, 0)

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
        if (pkg.pm2) {
            packageData[pkg.name].pm2 = pkg.pm2;
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

function addPm2Package(pkg, installPath) {
    try {
        const user = getUser();
        execSync(`sudo -u ${user} pm2 start ${path.join(installPath, pkg.pm2.file)} -f --name ${pkg.pm2.name}`, { stdio: "inherit" });
        execSync(`sudo -u ${user} pm2 save`, { stdio: "inherit" });

        exec(`pm2 startup systemd -u ${user} --hp ${getHomeDir()}`, (error, stdout, stderr) => {
            const output = (stdout + stderr).split("\n");

            console.log(chalk.cyan("Run this command to enable PM2 startup at boot:"));

            const sudoLine = output.find(line => line.includes("sudo") && line.includes("pm2 startup"));
            if (sudoLine) {
                console.log(sudoLine.trim());
            } else {
                console.log(chalk.yellow("Couldn't find the PM2 startup sudo command."));
            }
        });
    } catch (err) {
        console.error(chalk.orange(err));
        throw err;
    }
}

function removePm2Pacakge(pkg) {
    try {
        const user = getUser();
        execSync(`sudo -u ${user} pm2 delete ${pkg.pm2.name}`, { stdio: "inherit" });
    } catch (err) {
        console.error(chalk.orange(err));
        throw err;
    }
}

function restartPm2Package(pkg) {
    try {
        const user = getUser();
        execSync(`sudo -u ${user} pm2 restart ${pkg.pm2.name}`, { stdio: "inherit" });
    } catch (err) {
        console.error(chalk.orange(err));
        throw err;
    }
}

async function installPackage(user, repoName, branch, privateRepo, forceInstall) {
    repoName = repoName.replace(".git", "");
    const spinner = ora(`Installing package: ${repoName}`).start();
    const tempDir = path.join(getCurrentDir(), "tempPackages", repoName);
    safeRemove(tempDir);

    let installPath;

    try {
        ensureDir(tempDir);
        await cloneRepo(tempDir, user, repoName, branch, privateRepo);
        const pkg = getPackageJson(tempDir);
        const packageName = pkg.name || repoName;
        installPath = getAndCreateInstallPath(pkg, packageName, forceInstall);
        moveFilesToInstallPath(installPath, tempDir);
        fixPermissions(installPath);
        installDependancies(installPath);
        addPackageData(pkg, installPath);
        spinner.succeed(`Installed package: ${packageName}`);
        if (pkg.nginx) {
            addServiceFromPackage(pkg);
        }
        if (pkg.pm2) {
            addPm2Package(pkg, installPath);
        }
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
        if (pkg.nginx) {
            removeService(pkg.nginx.service.name);
        }
        if (pkg.pm2) {
            removePm2Pacakge(pkg);
        }
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
        if (pkgJson.nginx) {
            addServiceFromPackage(pkgJson);
        }
        if (pkgJson.pm2) {
            restartPm2Package(pkgJson);
        }
    } catch (err) {
        spinner.fail("Failed to update.");
        console.error(err);
        throw err;
    }
}

function runPackage(packageName) {
    try {
        const packageDataPath = path.join(getCurrentDir(), "packageData.json");
        const packageData = JSON.parse(fs.readFileSync(packageDataPath));
        const pkg = getPackageJson(packageData[packageName].installPath);
        const script = pkg.scripts.start;
        execSync(script, { cwd: packageData[packageName].installPath,  stdio: "inherit" });
    } catch (err) {
        console.error(chalk.orange(err));
        throw err;
    }
}

function nginxCommands(command, args) {
    const serviceConfigPath = path.join(getCurrentDir(), "nginxServiceConfig.json");
    const serverConfigPath = path.join(getCurrentDir(), "nginxServerConfig.json");
    const noreload = args.n || args.noreload;

    if (command == "addService") {
        try {
            addNewService(args._[2], args._[3], args._[4], !args.http, stringToArray(args._[5]), !noreload);
        } catch (err) {
            console.error(chalk.orange(err));
            throw err;
        }
        return;
    }
    if (command == "addServer") {
        try {
            addNewServer(args._[2], stringToArray(args._[3]), args._[4], args._[5], !noreload);
        } catch (err) {
            console.error(chalk.orange(err));
            throw err;
        }
        return;
    }
    if (command == "removeService") {
        try {
            removeService(args._[2], !noreload);
        } catch (err) {
            console.error(chalk.orange(err));
            throw err;
        }
        return;
    }
    if (command == "removeServer") {
        try {
            removeServer(args._[2], !noreload);
        } catch (err) {
            console.error(chalk.orange(err));
            throw err;
        }
        return;
    }
    if (command == "reload") {
        const spinner = ora("Reloading Nginx config...").start();
        try {
            updateNginxConfig();
            spinner.succeed("Reloaded Nginx");
        } catch (err) {
            spinner.fail("Failed to reload nginx confix");
            console.error(chalk.orange(err));
            throw err;
        }
        return;
    }
    if (command == "listServices") {
        const serviceConfigJson = JSON.parse(fs.readFileSync(serviceConfigPath));
        console.log(chalk.cyan("Nginx Services:"));
        printTable(prependToKeyValue(serviceConfigJson, "uri", "/"), ["port", "uri", "https", "servers"], 30);
        return;
    }
    if (command == "listServers") {
        const serverConfigJson = JSON.parse(fs.readFileSync(serverConfigPath));
        console.log(chalk.cyan("Nginx Servers:"));
        printTable(serverConfigJson, ["urls", "certificate", "certificateKey"], 30);
        return;
    }
    if (command == "help" || command == "h" || command == "?" || !command) {
        console.log(chalk.cyan("Nginx Commands:"));
        console.log("sudo ppm nginx", chalk.cyan("addService"), "<name> <port> <uri> <servers>       [--http] [--noreload, -n]");
        console.log("sudo ppm nginx", chalk.cyan("addServer"), "<name> <urls> <certificate> <certificate key> [--noreload, -n]");
        console.log("sudo ppm nginx", chalk.cyan("removeService"), "<service name>                            [--noreload, -n]");
        console.log("sudo ppm nginx", chalk.cyan("removeServer"), "<server name>                              [--noreload, -n]");
        console.log("sudo ppm nginx", chalk.cyan("reload"));
        console.log("sudo ppm nginx", chalk.cyan("listServices"));
        console.log("sudo ppm nginx", chalk.cyan("listServers"));
        return;
    }
    console.log(chalk.cyan('Unknown Nginx Command. "ppm nginx help" for help'));
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
        boolean: ['p', 'private', 'f', 'force', 'n', 'noreload', 'http']
    });

    const packageDataPath = path.join(getCurrentDir(), "packageData.json");

    const command = args._[0];

    if (command == "install") {
        const user = args._[1];
        const repoName = args._[2];
        const privateRepo = args.p || args.private;
        const forceInstall = args.f || args.force;
        const branch = args.branch || "main";
        if (!user) {
            console.error(chalk.orange("No user was provided"));
            return;
        }
        if (!repoName) {
            console.error(chalk.orange("No repository name was provided"));
            return;
        }

        await installPackage(user, repoName, branch, privateRepo, forceInstall);
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
    if (command == "run") {
        const packageName = args._[1];
        if (!packageName) {
            console.error(chalk.orange("No package name was provided"));
            return;
        }

        runPackage(packageName);
        return;
    }
    if (command == "list") {
        const packageData = JSON.parse(fs.readFileSync(packageDataPath));
        console.log(chalk.cyan("Packages:"));
        printTable(packageData, ["version", "description", "installPath"], 40);
        return;
    }
    if (command == "nginx") {
        nginxCommands(args._[1], args);
        return;
    }
    if (command == "help" || command == "h" || command == "?" || !command) {
        console.log(chalk.cyan("Commands: "));
        console.log("sudo ppm", chalk.cyan("install"), "<username/orginisation> <Repository name> [--private, -p] [--force, -f] [--branch <branch>]");
        console.log("sudo ppm", chalk.cyan("uninstall"), "<Package name>");
        console.log("sudo ppm", chalk.cyan("update"), "<Package name>");
        console.log("sudo ppm", chalk.cyan("run"), "<Package name>");
        console.log("sudo ppm", chalk.cyan("list"));
        console.log("sudo ppm", chalk.cyan("nginx"), "<Nginx command>");
        return;
    }
    console.log(chalk.cyan('Unknown Command. "ppm help" for help'));
}