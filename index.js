#!/usr/bin/env node

import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import simpleGit from "simple-git";
import chalk from "chalk";
import ora from "ora";
import { listeners } from "process";

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
            const configResult = execSync(
                `curl -X PUT --unix-socket /var/run/control.unit.sock http://localhost/config -d '${JSON.stringify(unitConfig)}'`,
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

        const config = {
            "action": {
                "proxy": `http://127.0.0.1:${port}`
            },
            "match": {
                "uri": `${uri}*`
            }
        };

        const listenerPatch = {
            "listeners": {
                "*:443": {
                    "tls": {
                        "certificate": "flamey-cert"
                    },
                    "pass": "routes/secure"
                }
            }
        };

        const configPath = "/tmp/unit-route.json";
        fs.writeFileSync(configPath, JSON.stringify(config));

        const curlAddRoute = `curl -X PATCH --data-binary @${configPath} ` +
            `--unix-socket /var/run/control.unit.sock ` +
            `http://localhost/config/routes/secure`;

        const listenerPatchPath = "/tmp/unit-listener.json";
        fs.writeFileSync(listenerPatchPath, JSON.stringify(listenerPatch))

        const curlPathListener = `curl -X PATCH --data-binary @${listenerPatchPath} ` +
            `--unix-socket /var/run/control.unit.sock ` +
            `http://localhost/config`;

        try {
            execSync(curlPathListener, { stdio: "inherit" });
            execSync(curlAddRoute, { stdio: "inherit" });
            console.log(chalk.green(`HTTPS route added: https://flameys.ddns.net${uri}`));
        } catch (err) {
            console.error(chalk.red("Failed to set Unit route:"), err);
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