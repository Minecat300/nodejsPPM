import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import chalk from "chalk";
import process from "process";

chalk.orange = chalk.rgb(255, 81, 0);
chalk.trueCyan = chalk.rgb(39, 185, 232);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function setUpFile(path, data) {
    fs.writeFileSync(expandHomeDir(path), data);
}

let currentHomeDir;

export function getUser() {
    return (
        process.env.SUDO_USER ||
        process.env.USER ||
        process.env.USERNAME ||
        process.env.LOGNAME ||
        "unknown"
    );
}

export function replaceWithEmpty(value, replace) {
    return replace === value ? "" : value;
}

export function getHomeDir() {
    if (!currentHomeDir) {
        const platform = process.platform;

        if (platform === "win32") {
            // Windows default home dir
            currentHomeDir = process.env.USERPROFILE ||
                             path.join(process.env.HOMEDRIVE || "C:", process.env.HOMEPATH || "\\Users\\Default");
        } else {
            // Linux/macOS default home dir
            if (process.env.SUDO_USER) {
                currentHomeDir = execSync(`getent passwd ${getUser()} | cut -d: -f6`).toString().trim();
            } else {
                currentHomeDir = os.homedir();
            }
        }

        // Final fallback, just in case
        if (!currentHomeDir) currentHomeDir = os.homedir();
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
    if (!targetPath) throw chalk.orange("No path provided.");

    const resolved = path.resolve(targetPath);

    const forbidden = process.platform === "win32"
        ? [
            "C:\\", "C:\\Windows", "C:\\Windows\\System32",
            "C:\\Program Files", "C:\\Program Files (x86)",
            process.env.SYSTEMROOT, process.env.WINDIR
        ]
        : ["/", "/root", "/home", "/etc", "/bin", "/usr", "/var"];

    const normalizedResolved = process.platform === "win32" ? resolved.toLowerCase() : resolved;

    // Only block the exact forbidden path, NOT subdirectories
    const isForbidden = forbidden.some(p => {
        if (!p) return false;
        const normP = process.platform === "win32" ? p.toLowerCase() : p;
        return normalizedResolved === normP; // exact match only
    });

    if (isForbidden) {
        throw chalk.red(`Refusing to remove critical path: ${resolved}`);
    }

    if (!fs.existsSync(resolved)) return;

    try {
        fs.rmSync(resolved, { recursive: true, force: true });
    } catch (err) {
        throw chalk.red(`Failed to remove ${resolved}: ${err.message}`);
    }
}


export function safeRemoveFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath);
        }
    } catch (err) {
        throw err;
    }
}

export function isDirEmpty(dirPath) {
    if (!fs.existsSync(dirPath)) return true;
    const files = fs.readdirSync(dirPath);
    return files.length === 0;
}

export function joinPreservedArrays(array1 = [], array2 = []) {
    array2.forEach(item => {
        if (!array1.includes(item)) {
            array1.push(item);
        }
    });
    return array1;
}

export function prependToKeyValue(obj, targetKey, prefix) {
    for (const mainKey in obj) {
        if (obj[mainKey] && typeof obj[mainKey] === "object") {
            if (targetKey in obj[mainKey]) {
                obj[mainKey][targetKey] = prefix + obj[mainKey][targetKey];
            }
        }
    }
    return obj;
}

export function stringToArray(str) {
    if (!str) {return [];}
    return str.split(",");
}

export function isBlank(str) {
    return typeof str !== "string" || str.trim() === "";
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
            string += ` ${truncate(data[atr], maxLength)}${spaces(lengthPerLines[i+1] - truncate(data[atr], maxLength).length)} │`;
        }
        printList.push(seperator);
        printList.push(string);
    }

    let header = "│ ";
    header += `${chalk.trueCyan("name")}${spaces(lengthPerLines[0] - "name".length)} │`;
    for (let i = 0; i < atrs.length; i++) {
        const atr = atrs[i];
        header += ` ${chalk.trueCyan(atr)}${spaces(lengthPerLines[i+1] - atr.length)} │`;
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