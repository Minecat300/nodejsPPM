import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.join(__dirname, "package.json");
if (!fs.existsSync(pkgPath)) {
    console.log("No package.json found in this folder. Exiting...");
    process.exit(1);
}

console.log("Installing dependencies...");
execSync("npm install", { cwd: __dirname, stdio: "inherit" });

const mainJsPath = path.join(__dirname, "main.js");
execSync(`chmod +x "${mainJsPath}"`, { stdio: "inherit" });

const globalCmdName = "ppm";
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

console.log(`Setup complete! You can now run '${globalCmdName}' from anywhere, with or without sudo.`);
