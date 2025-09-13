import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import chalk from "chalk";

chalk.orange = chalk.rgb(255, 165, 0);

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

export function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, force: true });
    }
}

export function safeRemove(targetPath) {
    if (!targetPath) {
        throw new Error(chalk.orange("No path provided."));
    }

    const resolved = path.resolve(targetPath);

    const forbidden = ["/", "/root", "/home", "/etc", "/bin", "/usr", "/var"];

    if (forbidden.includes(resolved)) {
        throw new Error(chalk.red(`Refusing to remove critical path: ${resolved}`));
    }

    if (resolved.split(path.sep).filter(Boolean).length < 2) {
        throw new Error(chalk.red(`Refusing to remove high-level path: ${resolved}`));
    }

    if (!fs.existsSync(resolved)) {
        return;
    }

    fs.rmSync(resolved, { recursive: true, force: true });
}

export function isDirEmpty(dirPath) {
    if (!fs.existsSync(dirPath)) return true;
    const files = fs.readdirSync(dirPath);
    return files.length === 0;
}

function spaces(num) {
    return " ".repeat(num);
}

function truncate(str, max) {
    str = String(str ?? "");
    return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

export function printTable(obj, atrs, maxLength = 20) {
    const printList = [];
    const lengthPerLines = new Array(atrs.length + 1).fill(4);

    lengthPerLines[0] = "name".length;
    for (let i = 0; i < atrs.length; i++) {
        if (lengthPerLines[i+1] < atrs[i].length) {
            lengthPerLines[i+1] = atrs[i].length;
        }
    }

    for (const name in obj) {
        let data = obj[name];
        if (lengthPerLines[0] < name.length) {
            lengthPerLines[0] = truncate(name, maxLength).length;
        }
        for (let i = 0; i < atrs.length; i++) {
            const atr = atrs[i];
            if (lengthPerLines[i+1] < truncate(data[atr], maxLength).length) {
                lengthPerLines[i+1] = truncate(data[atr], maxLength).length;
            }
        }
    }

    let seperator = "├";
    seperator += "─".repeat(lengthPerLines[0]+2);
    for (let i = 1; i < lengthPerLines.length; i++) {
        seperator += `┼${"─".repeat(lengthPerLines[i]+2)}`;
    }
    seperator += "┤";

    for (const name in obj) {
        let data = obj[name];
        let string = "│ ";
        string += `${truncate(name, maxLength)}${spaces(lengthPerLines[0] - name.length)} │`;

        for (let i = 0; i < atrs.length; i++) {
            const atr = atrs[i];
            string += ` ${data[atr]}${spaces(lengthPerLines[i+1] - truncate(data[atr], maxLength).length)} │`;
        }
        printList.push(seperator);
        printList.push(string);
    }

    let header = "│ ";
    header += `${chalk.cyan("name")}${spaces(lengthPerLines[0] - "name".length)} │`;
    for (let i = 0; i < atrs.length; i++) {
        const atr = atrs[i];
        header += ` ${chalk.cyan(atr)}${spaces(lengthPerLines[i+1] - atr.length)} │`;
    }

    let topString = "┌";
    topString += "─".repeat(lengthPerLines[0]+2);
    for (let i = 1; i < lengthPerLines.length; i++) {
        topString += `┬${"─".repeat(lengthPerLines[i]+2)}`;
    }
    topString += "┐";

    let bottomString = "└";
    bottomString += "─".repeat(lengthPerLines[0]+2);
    for (let i = 1; i < lengthPerLines.length; i++) {
        bottomString += `┴${"─".repeat(lengthPerLines[i]+2)}`;
    }
    bottomString += "┘";

    printList.unshift(header);
    printList.unshift(topString);
    printList.push(bottomString);

    for (const string of printList) {
        console.log(string);
    }
}