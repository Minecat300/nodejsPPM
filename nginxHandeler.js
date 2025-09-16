import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import chalk from "chalk";

import { setUpFile, getCurrentDir, joinPreservedArrays, isBlank, safeRemove } from "./utils.js";

chalk.orange = chalk.rgb(255, 81, 0);

export function nginxSetup() {
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
    const serverConfigPath = path.join(getCurrentDir(), "nginxServerConfig.json");
    const serverConfigJson = JSON.parse(fs.readFileSync(serverConfigPath, "utf8"));

    for (const server in serverConfigJson) {
        const serverNginxPath = `/etc/nginx/sites-available/http${server}`;
        if (!fs.existsSync(serverNginxPath)) {
            fs.writeFileSync(serverNginxPath, "");
        }
        const serverConfigValues = serverConfigJson[server];
        const config = `

server {
    listen 80;
    server_name ${serverConfigValues.urls.join(" ")};

    return 301 https://$host$request_uri;
}

`.trim();
        fs.writeFileSync(serverNginxPath, config);

        const enabledPath = `/etc/nginx/sites-enabled/http${server}`;
        if (!fs.existsSync(enabledPath)) {
            execSync(`ln -s ${serverNginxPath} ${enabledPath}`);
        }
    }
    if (reload) {
        execSync(`systemctl reload nginx`);
    }
}

function updateNginxHTTPSConfig(reload = true) {
    const serverConfigPath = path.join(getCurrentDir(), "nginxServerConfig.json");
    const serviceConfigPath = path.join(getCurrentDir(), "nginxServiceConfig.json");
    const serverConfigJson = JSON.parse(fs.readFileSync(serverConfigPath, "utf8"));
    const serviceConfigJson = JSON.parse(fs.readFileSync(serviceConfigPath, "utf8"));

    for (const server in serverConfigJson) {
        const serverNginxPath = `/etc/nginx/sites-available/https${server}`;
        if (!fs.existsSync(serverNginxPath)) {
            fs.writeFileSync(serverNginxPath, "");
        }
        const serverConfigValues = serverConfigJson[server];
        let fullConfig = `
server {
    listen 443 ssl;
    server_name ${serverConfigValues.urls.join(" ")};
    ssl_certificate ${serverConfigValues.certificate};
    ssl_certificate_key ${serverConfigValues.certificateKey};
    client_max_body_size 1024M;

`
        for (const service in serviceConfigJson) {
            const serviceConfigValues = serviceConfigJson[service];
            if (!serviceConfigValues.servers.includes(server)) continue;

            const httpType = serviceConfigValues.https ? "https" : "http";
            fullConfig += `
    location /${serviceConfigValues.uri} {
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
        fs.writeFileSync(serverNginxPath, fullConfig.trim());

        const enabledPath = `/etc/nginx/sites-enabled/https${server}`;
        if (!fs.existsSync(enabledPath)) {
            execSync(`ln -s ${serverNginxPath} ${enabledPath}`);
        }
    }
    if (reload) {
        execSync(`systemctl reload nginx`);
    }
}

export function updateNginxConfig(reload = true) {
    updateNginxHTTPConfig(false);
    updateNginxHTTPSConfig(false);
    if (reload) {
        execSync(`systemctl reload nginx`);
    }
}

export function addNewService(name, port, uri, https = true, servers, updateConfig = true) {
    if (isBlank(name)) {
        console.error(chalk.orange("Name missing"));
        return;
    }
    if (port === undefined || port === null) {
        console.error(chalk.orange("Port missing"));
        return;
    }
    if (typeof port !== "number") {
        console.error(chalk.orange("Port must be a number"));
        return;
    }
    if (uri === undefined || uri === null) {
        console.error(chalk.orange("Uri missing"));
        return;
    }
    if (!Array.isArray(servers) || servers.length === 0) {
        console.error(chalk.orange("Servers missing"));
        return;
    }

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
    if (!name) {
        console.error(chalk.orange("Name missing"));
        return;
    }
    const serviceConfigPath = path.join(getCurrentDir(), "nginxServiceConfig.json");
    const serviceConfigJson = JSON.parse(fs.readFileSync(serviceConfigPath, "utf8"));
    if (!serviceConfigJson[name]) {
        console.error(chalk.orange(`${name} not found`));
        return;
    }
    delete serviceConfigJson[name];
    fs.writeFileSync(serviceConfigPath, JSON.stringify(serviceConfigJson, null, 2));
    updateNginxConfig(updateConfig);
}

export function addNewServer(name, urls, certificate, certificateKey, updateConfig = true) {
    if (isBlank(name)) {
        console.error(chalk.orange("name missing"));
        return;
    }
    if (!Array.isArray(urls) || urls.length === 0) {
        console.error(chalk.orange("urls missing"));
        return;
    }
    if (isBlank(certificate)) {
        console.error(chalk.orange("certificate missing"));
        return;
    }
    if (isBlank(certificateKey)) {
        console.error(chalk.orange("certificate key missing"));
        return;
    }

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
    if (!name) {
        console.error(chalk.orange("Name missing"));
        return;
    }
    const serverConfigPath = path.join(getCurrentDir(), "nginxServerConfig.json");
    const serviceConfigPath = path.join(getCurrentDir(), "nginxServiceConfig.json");
    const serverConfigJson = JSON.parse(fs.readFileSync(serverConfigPath, "utf8"));
    const serviceConfigJson = JSON.parse(fs.readFileSync(serviceConfigPath, "utf8"));

    if (!serverConfigJson[name]) {
        console.error(chalk.orange(`${name} not found`));
        return;
    }

    fs.rmSync(`/etc/nginx/sites-available/http${name}`);
    fs.rmSync(`/etc/nginx/sites-available/https${name}`);
    fs.rmSync(`/etc/nginx/sites-enabled/http${name}`);
    fs.rmSync(`/etc/nginx/sites-enabled/https${name}`);

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

export function addServiceFromPackage(pkg, updateConfig = true) {
    if (!pkg.nginx) {
        console.error(chalk.orange("Nginx config missing"));
        return;
    }
    const nginx = pkg.nginx;
    if (!nginx.service) {
        console.error(chalk.orange("service missing"));
        return;
    }
    const service = nginx.service;
    for (const server of service.servers) {
        if (!nginx[server]) {
            console.error(chalk.orange("Server('s) missing"));
            return;
        }
    }
    for (const server of service.servers) {
        const serverData = nginx[server];
        addNewServer(server, serverData.urls, serverData.certificate, serverData.certificateKey, false);
    }
    addNewService(service.name, service.port, service.uri, service.https, service.servers, updateConfig);
}