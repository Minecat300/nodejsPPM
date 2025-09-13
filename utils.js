import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import chalk from "chalk";

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

function spaces(num) {
    return " ".repeat(num);
}

export function printTable(obj, atrs) {
    const printList = [];
    const lengthPerLines = new Array(atrs.length + 1).fill(4);

    lengthPerLines[0] = "name".length;
    for (let i = 0; i < atrs.length; i++) {
        lengthPerLines[i+1] = atrs[i].length;
    }

    for (const name in obj) {
        let data = obj[name];
        if (lengthPerLines[0] < name.length) {
            lengthPerLines[0] = name.length;
        }
        for (let i = 0; i < atrs.length; i++) {
            const atr = atrs[i];
            if (lengthPerLines[i+1] < String(data[atr] ?? "").length) {
                lengthPerLines[i+1] = String(data[atr] ?? "").length;
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
        string += `${name}${spaces(lengthPerLines[0] - name.length)} │`;

        for (let i = 0; i < atrs.length; i++) {
            const atr = atrs[i];
            string += ` ${data[atr]}${spaces(lengthPerLines[i+1] - String(data[atr] ?? "").length)} │`;
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