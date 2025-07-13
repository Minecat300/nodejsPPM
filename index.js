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

function updateNginxConfig() {
    const configPath = path.join("/home/minecat300/", "packageManager/nginxConfig.json");
    const nginxConfigJson = JSON.parse(fs.readFileSync(configPath, "utf8"));

    let httpConfig = `
server {
    listen 80;
    server_name flameys.ddns.net 0.0.0.0;
    client_max_body_size 1024M;

`;

    let httpsConfig = `
server {
    listen 443 ssl;
    server_name flameys.ddns.net;
    ssl_certificate /etc/letsencrypt/live/flameys.ddns.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/flameys.ddns.net/privkey.pem;
    client_max_body_size 1024M;

`;

    for (const repoName in nginxConfigJson) {
        const config = nginxConfigJson[repoName];
        httpConfig += `
    location /${config.uri} {
        if ($request_method = OPTIONS ) {
            add_header 'Access-Control-Allow-Origin' '*' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Origin, Content-Type, Accept, Authorization' always;
            add_header 'Access-Control-Max-Age' 1728000;
            add_header 'Content-Length' 0;
            add_header 'Content-Type' 'text/plain charset=UTF-8';
            return 204;
        }

        # For actual requests
        add_header 'Access-Control-Allow-Origin' '*';

        proxy_pass https://localhost:${config.port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

`;
        httpsConfig += `
    location /${config.uri} {
        # Handle CORS preflight requests
        if ($request_method = OPTIONS ) {
            add_header 'Access-Control-Allow-Origin' '*' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Origin, Content-Type, Accept, Authorization' always;
            add_header 'Access-Control-Max-Age' 1728000;
            add_header 'Content-Length' 0;
            add_header 'Content-Type' 'text/plain charset=UTF-8';
            return 204;
        }

        # For actual requests
        add_header 'Access-Control-Allow-Origin' '*';

        proxy_pass https://localhost:${config.port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_ssl_verify off;
    }

`;
    }

    httpConfig += `
}
    `;
    httpsConfig += `
}
    `;

    const fullConfig = `
    
${httpConfig}

${httpsConfig}
    
    `;

    fs.writeFileSync("/etc/nginx/sites-available/default", fullConfig);
    execSync("nginx -s reload");
}

function setupPm2AutoStart(scriptPath, appName) {
    try {
        execSync(`pm2 start ${scriptPath} --name ${appName}`, { stdio: "inherit" });
        execSync(`pm2 save`, { stdio: "inherit" });

        const user = process.env.SUDO_USER || process.env.USER;
        const startupCmd = execSync(`pm2 startup systemd -u ${user} --hp /home/${user}`, { encoding: "utf8" });
        console.log("Run this command to enable pm2 startup:");
        const sudoCmdMatch = startupCmd.match(/sudo .*/);
        if (sudoCmdMatch) {
            console.log(sudoCmdMatch[0]);
        } else {
            console.log("Couldn't find the pm2 startup sudo command.");
        }
    } catch (err) {
        console.error("Error setting up pm2:", err);
    }
}


if (command === "install" && repoUrl) {
    installRepo(repoUrl);
} else {
    console.log(
        chalk.cyan("Usage: ppm install <github-repo-url>")
    );
}