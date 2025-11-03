import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import readline from "readline";
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

async function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans.trim());
    }));
}

if (isWindows) {
    execSync(`icacls "${mainJsPath}" /grant Everyone:RX`, { stdio: "inherit" });

    const choice = await askQuestion("Install globally for user or system? (u/s): ");
    const installScope = choice.toLowerCase().startsWith("s") ? 1 : 0;

    if (choice === "") {
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

    const cmdFile = path.join(binFolder, `${globalCmdName}.cmd`);
    const launcher = `@echo off
node "${mainJsPath}" %*
`;

    try {
        // 1. Create the folder
        if (!fs.existsSync(binFolder)) {
            if (needsAdmin) {
                console.log(`Creating system-wide folder at ${binFolder} (requires admin)...`);
                execSync(`powershell -Command "Start-Process PowerShell -Verb RunAs -ArgumentList 'New-Item -Path \\"${binFolder}\\" -ItemType Directory'"`, { stdio: "inherit" });
            } else {
                fs.mkdirSync(binFolder, { recursive: true });
                console.log(`Created folder ${binFolder}.`);
            }
        }

        // 2. Write the .cmd launcher
        if (needsAdmin) {
            console.log(`Creating system-wide launcher at ${cmdFile} (requires admin)...`);
            const tempFile = path.join(__dirname, "ppm_temp_launcher.cmd");
            fs.writeFileSync(tempFile, launcher);
            execSync(`powershell -Command "Start-Process PowerShell -Verb RunAs -ArgumentList 'Copy-Item -Path \\"${tempFile}\\" -Destination \\"${cmdFile}\\" -Force'"`, { stdio: "inherit" });
            fs.unlinkSync(tempFile);
        } else {
            fs.writeFileSync(cmdFile, launcher);
        }

        console.log(`Launcher created at ${cmdFile}.`);

        // 3. Add to PATH
        const pathToAdd = binFolder;
        const currentPath = process.env.PATH || "";
        if (!currentPath.toLowerCase().includes(pathToAdd.toLowerCase())) {
            if (needsAdmin) {
                console.log("Adding folder to system PATH (requires admin)...");
                execSync(`powershell -Command "Start-Process PowerShell -Verb RunAs -ArgumentList 'setx /M PATH \\"${currentPath};${pathToAdd}\\"'"`, { stdio: "inherit" });
            } else {
                console.log("Adding folder to user PATH...");
                execSync(`setx PATH "${currentPath};${pathToAdd}"`, { stdio: "inherit", shell: "cmd.exe" });
            }
            console.log("PATH updated! Restart your terminal to use the command globally.");
        } else {
            console.log(`${pathToAdd} is already in PATH.`);
        }
    } catch (err) {
        console.error("Failed to create launcher or update PATH:", err.message);
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
