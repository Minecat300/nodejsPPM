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
    for (const file of files) {
        fs.renameSync(path.join(tempDir, file), path.join(installPath, file));
    }
    fs.rmdirSync(tempDir);
    console.log(chalk.cyan(`Moved repo to ${installPath}`));

    spinner.start("Installing dependencies...");
    try {
        execSync("npm install", { cwd: installPath, stdio: "inherit" });
        spinner.succeed("Dependencies installed");
    } catch (err) {
        spinner.fail("npm install failed");
        console.error(chalk.red(err));
    }

    if (pkg.unitConfig) {
        const unitConfig = {
            listeners: {
                [`*:${pkg.unitConfig.listenerPort}`]: {
                    pass: `applications/${pkg.name}`
                }
            },
            applications: {
                [pkg.name]: {
                    type: "node",
                    working_directory: installPath,
                    script: pkg.unitConfig.script || "index.js"
                }
            }
        };

        spinner.start("Configuring Unit...");

        try {
            const tmpConfigPath = "/tmp/unit-config.json";
            fs.writeFileSync(tmpConfigPath, JSON.stringify(unitConfig));

            const configResult = execSync(
            `curl -X PUT --unix-socket /var/run/control.unit.sock --url http://localhost/config --data-binary @${tmpConfigPath}`,
            { stdio: "pipe" }
            );

            spinner.succeed("Unit configuration applied");
        } catch (err) {
            spinner.fail("Failed to apply Unit config");
            console.error(chalk.red(err.stderr?.toString() || err.toString()));
        }
    } else {
        console.log(chalk.yellow("No unitConfig found in package.json"));
    }

    if (pkg.unitRoute && pkg.unitRoute.uri && pkg.unitRoute.port) {
        const uri = pkg.unitRoute.uri;
        const port = pkg.unitRoute.port;
        const routeName = "secure";

        const config = {
        [routeName]: {
            action: {
            proxy: `http://127.0.0.1:${port}`
            },
            match: {
            uri: `${uri}*`
            }
        }
        };

        const listenerPatch = {
        listeners: {
            "*:443": {
            tls: {
                certificate: "flamey-cert"
            },
            pass: `routes/${routeName}`
            }
        }
        };

        const configPath = "/tmp/unit-route.json";
        const listenerPatchPath = "/tmp/unit-listener.json";

        fs.writeFileSync(configPath, JSON.stringify(config));
        fs.writeFileSync(listenerPatchPath, JSON.stringify(listenerPatch));

        spinner.start("Applying route config...");
        try {
        execSync(`curl -X PATCH --data-binary @${configPath} --unix-socket /var/run/control.unit.sock http://localhost/config/routes`, { stdio: "inherit" });
        spinner.succeed("Route config applied");

        spinner.start("Patching listener config...");
        execSync(`curl -X PUT --data-binary @${listenerPatchPath} --unix-socket /var/run/control.unit.sock http://localhost/config`, { stdio: "inherit" });
        spinner.succeed("Listener config patched");

        console.log(chalk.green(`HTTPS route added: https://flameys.ddns.net${uri}`));
        } catch (err) {
        spinner.fail("Failed to set Unit route");
        console.error(chalk.red("Error:"), err);
        }
    }
}

if (command === "install" && repoUrl) {
    installRepo(repoUrl);
} else {
    console.log(
        chalk.cyan("Usage: ppm install <github-repo-url>")
    );
}