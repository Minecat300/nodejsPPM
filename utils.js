import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function setUpFile(path, data) {
    fs.writeFileSync(expandHomeDir(path), data);
}

let currentHomeDir;

export function getHomeDir() { // shit i need the home dir to get the home dir... well thats useless
    if (!currentHomeDir) {
        const username = process.env.SUDO_USER || process.env.USER;
        const homeDir = execSync(`getent passwd ${username} | cut -d: -f6`).toString().trim();
        currentHomeDir = homeDir;
    }
    return currentHomeDir;
}

export function getCurrentDir() {
    return __dirname;
}

export function expandHomeDir(p) {
    if (!p) return p;
    if (p.startsWith("~")) {
        return path.join(getHomeDir(), p.slice(1));
    }
    return p;
}