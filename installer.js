import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as readline from "readline-sync";
import process from "process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const platform = process.platform;
const isWindows = platform === "win32";
const isLinux = platform === "linux";

if (platform === "darwin") {
    throw new Error("This software is not supported on MacOS. Please get a real pc");
}

if (!isWindows && !isLinux) {
    throw new Error(`This software is not supported on ${platform}.`);
}

const pkgPath = path.join(__dirname, "package.json");
if (!fs.existsSync(pkgPath)) {
    console.log("No package.json found in this folder. Exiting...");
    process.exit(1);
}

console.log("Installing dependencies...");
execSync("npm install", { cwd: __dirname, stdio: "inherit" });

const globalCmdName = "ppm";
const mainJsPath = path.join(__dirname, "main.js");

if (isWindows) {
    execSync(`icacls "${mainJsPath}" /grant Everyone:RX`, { stdio: "inherit" });

    const installScope = readline.keyInSelect(["User-wide", "System-wide"], "Install globally for user or system?");

    if (installScope === -1) {
        console.log("Installation canceled.");
        process.exit(0);
    }

    let binFolder;
    let needsAdmin = false;
    if (installScope === 0) {
        binFolder = path.join(process.env.USERPROFILE, "bin");
    } else {
        binFolder = "C:\\Program Files\\GlobalBin";
        needsAdmin = true;
    }

    try {
        if (!fs.existsSync(binFolder)) {
            if (needsAdmin) {
                console.log(`Creating system-wide folder at ${binFolder} (requires admin)...`);
                execSync(`powershell -Command "New-Item -Path '${binFolder}' -ItemType Directory"`, { stdio: "inherit" });
            } else {
                fs.mkdirSync(binFolder, { recursive: true });
                console.log(`Created folder ${binFolder}.`);
            }
        }

        const symlinkPath = path.join(binFolder, globalCmdName);

        if (!fs.existsSync(symlinkPath)) {
            console.log(`Creating symlink at ${symlinkPath}...`);

            if (needsAdmin) {
                const result = spawnSync("powershull.exe", [
                    "-Command",
                    `Start-Process powershell -Verb runAs -ArgumentList "New-Item -Path '${symlinkPath}' -ItemType SymbolicLink -Value '${mainJsPath}'"`
                ], { stdio: "inherit" });

                if (result.error) throw result.error;
            } else {
                fs.symlinkSync(mainJsPath, symlinkPath, "file");
            }
            
            console.log(`Symlink created at ${symlinkPath}.`);
        } else {
            console.log(`${globalCmdName} symlink already exists at ${binFolder}.`);
        }

        if (!needsAdmin) {
            const currentPath = process.env.PATH || "";
            if (!currentPath.toLowerCase().includes(binFolder.toLowerCase())){
                console.log(`Adding ${binFolder} to user PATH...`);
                execSync(`setx PATH "${currentPath};${binFolder}"`, { stdio: "inherit", shell: "cmd.exe" });
                console.log("PATH updated! Restart your terminal to use the command globally.");
            } else {
                console.log(`${binFolder} is already in PATH.`);
            }
        }
    } catch (err) {
        console.error("Failed to create symlink or update PATH:", err.message);
        process.exit(1);
    }
}

if (isLinux) {
    execSync(`chmod +x "${mainJsPath}"`, { stdio: "inherit" });

    const systemBin = "/usr/local/bin";
    const symlinkPath = path.join(systemBin, globalCmdName);

    try {
        if (!fs.existsSync(symlinkPath)) {
            console.log(`Creating system-wide symlink at ${symlinkPath} (requires sudo)...`);
            execSync(`sudo ln -s "${mainJsPath}" "${symlinkPath}"`, { stdio: "inherit" });
        } else {
            console.log(`${globalCmdName} symlink already exists in ${systemBin}.`);
        }
    } catch (err) {
        console.error("Failed to create system-wide symlink. Make sure you have sudo privileges.");
        process.exit(1);
    }
}

console.log(`Setup complete! You can now run '${globalCmdName}' from anywhere, with or without sudo.`);
