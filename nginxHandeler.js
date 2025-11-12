import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import chalk from "chalk";
import process from "process";
import inquirer from "inquirer";

import { setUpFile, getCurrentDir, joinPreservedArrays, isBlank, safeRemove, safeRemoveFile } from "./utils.js";
import { type } from "os";

chalk.orange = chalk.rgb(255, 81, 0);
chalk.trueCyan = chalk.rgb(39, 185, 232);

export function hasNginx() {
    try {
        const path = execSync("command -v nginx").toString().trim();
        return true;
    } catch {
        return false;
    }
}

function normalizePath(path) {
    if (typeof path !== 'string') path = String(path || '');

    path = path.trim();

    if (!path || /^\/+$/.test(path)) return '/';

    return `/${path.replace(/^\/+|\/+$/g, '')}/`;
}

function sudoWriteFile(filePath, content) {
    execSync(`sudo tee "${filePath}" > /dev/null << 'EOF'
${content}
EOF`);
}

function sudoSymlink(src, dest) {
    execSync(`sudo ln -sf ${src} ${dest}`);
}

export function nginxSetup() {
    if (process.platform === "win32") {
        console.warn(chalk.yellow("NGINX is not supported on Windows with PPM."));
        return;
    }
    if (!hasNginx()) {
        console.warn(chalk.yellow("NGINX is not installed on this system. Please install NGINX for its functions."));
    }

    const servicePath = path.join(getCurrentDir(), "nginxServiceConfig.json");
    const serverPath = path.join(getCurrentDir(), "nginxServerConfig.json");
    if (!fs.existsSync(servicePath)) {
        setUpFile(servicePath, "{}");
    }
    if (!fs.existsSync(serverPath)) {
        setUpFile(serverPath, "{}");
    }
}

function updateNginxHTTPConfig(reload = true) {
    if (!hasNginx()) {
        console.warn(chalk.yellow("NGINX not installed."));
        return;
    }

    const serverConfigPath = path.join(getCurrentDir(), "nginxServerConfig.json");
    const serverConfigJson = JSON.parse(fs.readFileSync(serverConfigPath, "utf8"));

    for (const server in serverConfigJson) {
        const serverNginxPath = `/etc/nginx/sites-available/http${server}`;
        const enabledPath = `/etc/nginx/sites-enabled/http${server}`;
        const serverConfigValues = serverConfigJson[server];

        const config = `
server {
    listen 80;
    server_name ${serverConfigValues.urls.join(" ")};
    return 301 https://$host$request_uri;
}
`.trim();

        sudoWriteFile(serverNginxPath, config);
        sudoSymlink(serverNginxPath, enabledPath);
    }

    if (reload) execSync(`sudo systemctl reload nginx`);
}

function updateNginxHTTPSConfig(reload = true) {
    if (!hasNginx()) {
        console.warn(chalk.yellow("NGINX not installed."));
        return;
    }

    const serverConfigPath = path.join(getCurrentDir(), "nginxServerConfig.json");
    const serviceConfigPath = path.join(getCurrentDir(), "nginxServiceConfig.json");
    const serverConfigJson = JSON.parse(fs.readFileSync(serverConfigPath, "utf8"));
    const serviceConfigJson = JSON.parse(fs.readFileSync(serviceConfigPath, "utf8"));

    for (const server in serverConfigJson) {
        const serverNginxPath = `/etc/nginx/sites-available/https${server}`;
        const enabledPath = `/etc/nginx/sites-enabled/https${server}`;
        const serverConfigValues = serverConfigJson[server];

        // Skip servers missing certs
        if (!serverConfigValues.certificate || !serverConfigValues.certificateKey) continue;
        if (!fs.existsSync(serverConfigValues.certificate) || !fs.existsSync(serverConfigValues.certificateKey)) continue;

        let fullConfig = `
server {
    listen 443 ssl;
    server_name ${serverConfigValues.urls.join(" ")};
    ssl_certificate ${serverConfigValues.certificate};
    ssl_certificate_key ${serverConfigValues.certificateKey};
    client_max_body_size 1024M;
`;

        for (const service in serviceConfigJson) {
            const serviceConfigValues = serviceConfigJson[service];
            if (!serviceConfigValues.servers.includes(server)) continue;

            const httpType = serviceConfigValues.https ? "https" : "http";
            fullConfig += `
    location ${normalizePath(serviceConfigValues.uri)} {
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

        proxy_pass ${httpType}://localhost:${serviceConfigValues.port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_ssl_verify off;
    }

`
        }
        fullConfig += `
}
`

        sudoWriteFile(serverNginxPath, fullConfig);
        sudoSymlink(serverNginxPath, enabledPath);
    }

    if (reload) execSync(`sudo systemctl reload nginx`);
}


export function updateNginxConfig(reload = true) {
    if (process.platform === "win32") return;

    if (!hasNginx()) {
        console.warn(chalk.yellow("NGINX is not installed on this system. Please install NGINX for its functions."));
        return;
    }

    updateNginxHTTPConfig(false);
    updateNginxHTTPSConfig(false);
    if (reload) {
        execSync(`sudo systemctl reload nginx`);
    }
}

export function addNewService(name, port, uri, https = true, servers, updateConfig = true) {
    if (process.platform === "win32") return;

    if (isBlank(name)) throw chalk.orange("Name missing");

    if (port === undefined || port === null) throw chalk.orange("Port missing");
    if (typeof port !== "number") throw chalk.orange("Port must be a number");

    if (uri === undefined || uri === null) throw chalk.orange("Uri missing");
    if (!Array.isArray(servers) || servers.length === 0) throw chalk.orange("Servers missing");

    const serviceConfigPath = path.join(getCurrentDir(), "nginxServiceConfig.json");
    const serviceConfigJson = JSON.parse(fs.readFileSync(serviceConfigPath, "utf8"));

    if (serviceConfigJson[name]) {
        console.warn(chalk.yellow(`Service "${name}" already exists. Overwriting.`));
    }

    serviceConfigJson[name] = {
        port,
        uri,
        https,
        servers
    };
    fs.writeFileSync(serviceConfigPath, JSON.stringify(serviceConfigJson, null, 2));
    updateNginxConfig(updateConfig);
}

export function removeService(name, updateConfig = true) {
    if (process.platform === "win32") return;

    if (!name) throw chalk.orange("Name missing");

    const serviceConfigPath = path.join(getCurrentDir(), "nginxServiceConfig.json");
    const serviceConfigJson = JSON.parse(fs.readFileSync(serviceConfigPath, "utf8"));
    if (!serviceConfigJson[name]) throw chalk.orange(`${name} not found`);

    delete serviceConfigJson[name];
    fs.writeFileSync(serviceConfigPath, JSON.stringify(serviceConfigJson, null, 2));
    updateNginxConfig(updateConfig);
}

export function addNewServer(name, urls, certificate, certificateKey, updateConfig = true) {
    if (process.platform === "win32") return;

    if (isBlank(name)) throw chalk.orange("name missing");
    if (!Array.isArray(urls) || urls.length === 0) throw chalk.orange("urls missing");

    const serverConfigPath = path.join(getCurrentDir(), "nginxServerConfig.json");
    const serverConfigJson = JSON.parse(fs.readFileSync(serverConfigPath, "utf8"));

    if (serverConfigJson[name]) {
        console.warn(chalk.yellow(`Server "${name}" already exists. Overwriting.`));
    }

    const newUrls = joinPreservedArrays(serverConfigJson[name]?.urls ?? [], urls)

    serverConfigJson[name] = {
        urls: newUrls,
        certificate,
        certificateKey
    };
    fs.writeFileSync(serverConfigPath, JSON.stringify(serverConfigJson, null, 2));
    updateNginxConfig(updateConfig);
}

export function removeServer(name, updateConfig = true) {
    if (process.platform === "win32") return;

    if (!name) throw chalk.orange("Name missing");

    const serverConfigPath = path.join(getCurrentDir(), "nginxServerConfig.json");
    const serviceConfigPath = path.join(getCurrentDir(), "nginxServiceConfig.json");
    const serverConfigJson = JSON.parse(fs.readFileSync(serverConfigPath, "utf8"));
    const serviceConfigJson = JSON.parse(fs.readFileSync(serviceConfigPath, "utf8"));

    if (!serverConfigJson[name]) throw chalk.orange(`${name} not found`);

    safeRemoveFile(`/etc/nginx/sites-available/http${name}`);
    safeRemoveFile(`/etc/nginx/sites-available/https${name}`);
    safeRemoveFile(`/etc/nginx/sites-enabled/http${name}`);
    safeRemoveFile(`/etc/nginx/sites-enabled/https${name}`);

    for (const service in serviceConfigJson) {
        const serviceConfigValues = serviceConfigJson[service];
        if (!serviceConfigValues.servers.includes(name)) continue;
        if (serviceConfigValues.servers.length > 1) {
            serviceConfigValues.servers.splice(serviceConfigValues.servers.indexOf(name), 1);
            continue;
        }
        removeService(service, false);
    }
    delete serverConfigJson[name];
    fs.writeFileSync(serviceConfigPath, JSON.stringify(serviceConfigJson, null, 2));
    fs.writeFileSync(serverConfigPath, JSON.stringify(serverConfigJson, null, 2));
    updateNginxConfig(updateConfig);
}

export async function addServiceFromPackage(pkg, updateConfig = true) {
    if (process.platform === "win32") return;

    if (!pkg.nginx) throw chalk.orange("Nginx config missing");
    const nginx = pkg.nginx;

    if (!nginx.service) throw chalk.orange("service missing");
    const service = nginx.service;

    let servers = service.servers;

    const serverPath = path.join(getCurrentDir(), "nginxServerConfig.json")
    const allServers = JSON.parse(fs.readFileSync(serverPath));

    if (servers == "ask") servers = await getServerSelection(Object.keys(allServers));

    if (servers.length === 0) throw chalk.orange("No Servers selected");

    for (const server of servers) {
        if (!nginx[server] && !allServers[server]) throw chalk.orange("Server('s) missing");
    }

    for (const server of servers) {
        if (!nginx[server]) continue;
        const serverData = nginx[server];
        addNewServer(server, serverData.urls, serverData.certificate, serverData.certificateKey, false);
    }
    addNewService(service.name, service.port, service.uri, service.https, servers, updateConfig);
}

async function getServerSelection(servers) {
    const choices = servers.concat([
        new inquirer.Separator(),
        "Cancel"
    ]);

    try {
        const awnser = await inquirer.prompt([
            {
                type: "checkbox",
                name: "actions",
                message: "Select server(s) to use (space to toggle, enter to confirm):",
                choices: choices,
                pageSize: 10,
                validate: (selected) => {
                    if (selected.includes("Cancel")) {
                        return true;
                    }
                    if (selected.length === 0) {
                        return "You must select at least one option, or Cancel.";
                    }
                    return true;
                }
            }
        ]);

        if (awnser.actions.includes("Cancel") || awnser.actions.length === 0) {
            console.log("Opperation Cancelled");
        }

        return awnser.actions;
    } catch (err) {
        throw "Cancelled";
    }
}