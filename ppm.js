import fs from "fs";
import path from "path";
import os from "os";
import minimist from "minimist";
import ora from "ora";
import chalk from "chalk";
import { execSync, exec } from "child_process";
import process from "process";

import { expandHomeDir, getCurrentDir, setUpFile, printTable, safeRemove, ensureDir, isDirEmpty, prependToKeyValue, stringToArray, getUser, getHomeDir, replaceWithEmpty } from "./utils.js";
import { nginxSetup, addServiceFromPackage, removeService, removeServer, addNewService, addNewServer, updateNginxConfig, hasNginx } from "./nginxHandeler.js";
import { cloneRepo, gitPullRepo } from "./gitHandeler.js";

chalk.orange = chalk.rgb(255, 81, 0)
chalk.trueCyan = chalk.rgb(39, 185, 232);

function getPackageJson(dir) {
    try {
        const packagePath = path.join(dir, "package.json");
        if (!fs.existsSync(packagePath)) throw chalk.orange("No package.json was found! Can't continue.");

        const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        return pkg;

    } catch (err) {
        throw err;
    }
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
            throw chalk.orange("Install path not empty");
        }
        ensureDir(installPath);
        return installPath;
    } catch (err) {
        throw err;
    }
}

function moveFilesToInstallPath(spinner, installPath, tempDir) {
    spinner.text = `Moving files to: ${installPath}`
    try {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            fs.renameSync(path.join(tempDir, file), path.join(installPath, file));
        }
        fs.rmdirSync(tempDir);
        spinner.text = `Moved files to: ${installPath}`;

    } catch (err) {
        throw err;
    }
}

export function fixPermissions(installPath) {
    try {
        if (process.platform === "win32") {
            console.log(chalk.yellow("Skipping ownership fix on Windows."));
            return;
        }

        const username = process.env.SUDO_USER || os.userInfo().username;
        execSync(`chown -R ${username}:${username} "${installPath}"`, { stdio: "inherit" });
        console.log(chalk.green(`Fixed file ownership to user ${username}`));
    } catch (err) {
        console.warn(chalk.yellow(`Could not fix ownership: ${err.message}`));
    }
}

function installDependancies(installPath) {
    try {
        execSync("npm install", { cwd: installPath, stdio: "inherit" });
        console.log("Dependencies installed");

    } catch (err) {
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
        throw err;
    }
}

export function addPm2Package(pkg, installPath) {
    try {
        if (process.platform === "win32") {
            // Windows: no sudo, just run PM2 as current user
            execSync(`pm2 restart ${pkg.pm2.name} || pm2 start ${path.join(installPath, pkg.pm2.file)} --name ${pkg.pm2.name}`, { stdio: "inherit" });
            execSync("pm2 save", { stdio: "inherit" });
            console.log(chalk.green("PM2 configured on Windows as current user."));
        } else {
            // Linux/macOS: keep original logic
            const user = getUser();
            execSync(`sudo -u ${user} pm2 restart ${pkg.pm2.name} || sudo -u ${user} pm2 start ${path.join(installPath, pkg.pm2.file)} --name ${pkg.pm2.name}`, { stdio: "inherit" });
            execSync(`sudo -u ${user} pm2 save`, { stdio: "inherit" });

            exec("pm2 startup systemd", (error, stdout, stderr) => {
                const output = stdout + stderr;
                const sudoLine = output.split("\n").find(l => l.includes("sudo"));
                console.log(sudoLine ? sudoLine.trim() : chalk.yellow("No sudo command needed, PM2 configured automatically."));
            });
        }
    } catch (err) {
        throw err;
    }
}

export function removePm2Package(pkg) {
    try {
        if (process.platform === "win32") {
            execSync(`pm2 delete ${pkg.pm2.name}`, { stdio: "inherit" });
        } else {
            const user = getUser();
            execSync(`sudo -u ${user} pm2 delete ${pkg.pm2.name}`, { stdio: "inherit" });
        }
    } catch (err) {
        throw err;
    }
}

export function restartPm2Package(pkg) {
    try {
        if (process.platform === "win32") {
            execSync(`pm2 restart ${pkg.pm2.name}`, { stdio: "inherit" });
        } else {
            const user = getUser();
            execSync(`sudo -u ${user} pm2 restart ${pkg.pm2.name}`, { stdio: "inherit" });
        }
    } catch (err) {
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
        await cloneRepo(spinner, tempDir, user, repoName, branch, privateRepo);
        const pkg = getPackageJson(tempDir);
        const packageName = pkg.name || repoName;
        installPath = getAndCreateInstallPath(pkg, packageName, forceInstall);
        moveFilesToInstallPath(spinner, installPath, tempDir);
        fixPermissions(installPath);
        installDependancies(installPath);
        addPackageData(pkg, installPath);
        spinner.succeed(`Installed package: ${packageName}`);

        if (pkg.nginx) addServiceFromPackage(pkg);
        if (pkg.pm2) addPm2Package(pkg, installPath);

    } catch (err) {
        safeRemove(tempDir);

        if (installPath) safeRemove(installPath);

        spinner.fail("Failed to install.");
        throw err;
    }
}

function uninstallPackage(packageName) {
    const spinner = ora(`Uninstalling package: ${packageName}...`).start();
    try {
        const packageDataPath = path.join(getCurrentDir(), "packageData.json");
        const packageData = JSON.parse(fs.readFileSync(packageDataPath));

        const pkg = packageData[packageName];
        if (!pkg) throw chalk.orange(`Package ${packageName} was not found`);

        safeRemove(pkg.installPath);
        removePackageData(packageName);
        spinner.succeed(`Uninstalled package: ${packageName}`);
        if (pkg.nginx) removeService(pkg.nginx.service.name);
        if (pkg.pm2) removePm2Package(pkg);
    
    } catch (err) {
        spinner.fail("Failed to uninstall.");
        throw err;
    }
}

async function updatePackage(packageName) {
    const spinner = ora(`Updating package: ${packageName}...`).start();
    try {
        const packageDataPath = path.join(getCurrentDir(), "packageData.json");
        const packageData = JSON.parse(fs.readFileSync(packageDataPath));

        const pkg = packageData[packageName];
        if (!pkg) throw chalk.orange(`Package ${packageName} was not found`);

        await gitPullRepo(spinner, pkg.installPath);
        installDependancies(pkg.installPath);
        removePackageData(packageName);
        const pkgJson = getPackageJson(pkg.installPath);
        addPackageData(pkgJson, pkg.installPath);
        console.log(chalk.green(`Version ${pkg.version} -> ${pkgJson.version}`));
        spinner.succeed(`Updated package: ${packageName}`);

        if (pkgJson.nginx) addServiceFromPackage(pkgJson);
        if (pkgJson.pm2) restartPm2Package(pkgJson);

    } catch (err) {
        spinner.fail("Failed to update.");
        throw err;
    }
}

function runPackage(packageName, commands) {
    try {
        const packageDataPath = path.join(getCurrentDir(), "packageData.json");
        const packageData = JSON.parse(fs.readFileSync(packageDataPath));
        if (!packageData[packageName]) throw chalk.orange(`Pakcage ${packageName} not found`);
        const pkg = getPackageJson(packageData[packageName].installPath);
        const script = pkg.scripts.start;
        execSync(`${script} ${commands.join(" ")}`, { cwd: packageData[packageName].installPath,  stdio: "inherit" });
    } catch (err) {
        throw err;
    }
}

function nginxCommands(command, args) {
    if (process.platform === "win32") {
        console.warn(chalk.yellow("NGINX is not supported on Windows with PPM."));
        return;
    }
    if (!hasNginx()) {
        console.warn(chalk.yellow("NGINX is not installed on this system. Please install NGINX for its functions."));
        return;
    }

    const serviceConfigPath = path.join(getCurrentDir(), "nginxServiceConfig.json");
    const serverConfigPath = path.join(getCurrentDir(), "nginxServerConfig.json");
    const noreload = args.n || args.noreload;

    try {
        if (command == "addService") {
            addNewService(args._[2], args._[3], replaceWithEmpty(args._[4], "/"), !args.http, stringToArray(args._[5]), !noreload);
            return;
        }
        if (command == "addServer") {
            addNewServer(args._[2], stringToArray(args._[3]), args._[4], args._[5], !noreload);
            return;
        }
        if (command == "removeService") {
            removeService(args._[2], !noreload);
            return;
        }
        if (command == "removeServer") {

            removeServer(args._[2], !noreload);
            return;
        }
        if (command == "reload") {
            const spinner = ora("Reloading Nginx config...").start();
            try {
                updateNginxConfig();
                spinner.succeed("Reloaded Nginx");
            } catch (err) {
                spinner.fail("Failed to reload nginx confix");
                throw err;
            }
            return;
        }
        if (command == "listServices") {
            const serviceConfigJson = JSON.parse(fs.readFileSync(serviceConfigPath));
            console.log(chalk.trueCyan("Nginx Services:"));
            printTable(prependToKeyValue(serviceConfigJson, "uri", "/"), args._[2] ? stringToArray(args._[2]) : ["port", "uri", "https", "servers"], args._[2] ? 100 : 30);
            return;
        }
        if (command == "listServers") {
            const serverConfigJson = JSON.parse(fs.readFileSync(serverConfigPath));
            console.log(chalk.trueCyan("Nginx Servers:"));
            printTable(serverConfigJson, args._[2] ? stringToArray(args._[2]) : ["urls", "certificate", "certificateKey"], args._[2] ? 100 : 30);
            return;
        }
        if (command == "help" || command == "h" || command == "?" || !command) {
            console.log(chalk.trueCyan("Nginx Commands:"));
            console.log("ppm nginx", chalk.trueCyan("addService"), "<name> <port> <uri> <servers>       [--http] [--noreload, -n]");
            console.log("ppm nginx", chalk.trueCyan("addServer"), "<name> <urls> <certificate> <certificate key> [--noreload, -n]");
            console.log("ppm nginx", chalk.trueCyan("removeService"), "<service name>                            [--noreload, -n]");
            console.log("ppm nginx", chalk.trueCyan("removeServer"), "<server name>                              [--noreload, -n]");
            console.log("ppm nginx", chalk.trueCyan("reload"));
            console.log("ppm nginx", chalk.trueCyan("listServices"), "<Item (optional)>");
            console.log("ppm nginx", chalk.trueCyan("listServers"), "<Item (optional)>");
            return;
        }
        console.log(chalk.trueCyan('Unknown Nginx Command. "ppm nginx help" for help'));

    } catch (err) {
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
        boolean: ['p', 'private', 'f', 'force', 'n', 'noreload', 'http']
    });

    const packageDataPath = path.join(getCurrentDir(), "packageData.json");

    const command = args._[0];

    try {
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
            if (!packageName) throw chalk.orange("No package name was provided");

            uninstallPackage(packageName);
            return;
        }
        if (command == "update") {
            const packageName = args._[1];
            if (!packageName) throw chalk.orange("No package name was provided");

            updatePackage(packageName);
            return;
        }
        if (command == "run") {
            const packageName = args._[1];
            if (!packageName) chalk.orange("No package name was provided");

            runPackage(packageName, process.argv.slice(4));
            return;
        }
        if (command == "list") {
            const packageData = JSON.parse(fs.readFileSync(packageDataPath));
            console.log(chalk.trueCyan("Packages:"));
            printTable(packageData, args._[1] ? stringToArray(args._[1]) : ["version", "description", "installPath"], args._[1] ? 100 : 40);
            return;
        }
        if (command == "nginx") {
            nginxCommands(args._[1], args);
            return;
        }
        if (command == "help" || command == "h" || command == "?" || !command) {
            console.log(chalk.trueCyan("Commands: "));
            console.log("ppm", chalk.trueCyan("install"), "<username/orginisation> <Repository name> [--private, -p] [--force, -f] [--branch <branch>]");
            console.log("ppm", chalk.trueCyan("uninstall"), "<Package name>");
            console.log("ppm", chalk.trueCyan("update"), "<Package name>");
            console.log("ppm", chalk.trueCyan("run"), "<Package name>");
            console.log("ppm", chalk.trueCyan("list"), "<Item (optional)>");
            console.log("ppm", chalk.trueCyan("nginx"), "<Nginx command>");
            return;
        }
        console.log(chalk.trueCyan('Unknown Command. "ppm help" for help'));

    } catch (err) {
        console.error(err);
    }
}