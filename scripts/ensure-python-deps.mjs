import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const python = process.env.PYTHON || "python3";
const requiredModules = ["numpy", "pandas", "scipy", "matplotlib", "requests", "yfinance", "tabulate"];

const probe = spawnSync(python, ["-c", `import ${requiredModules.join(", ")}`], {
  stdio: "ignore"
});

if (probe.status === 0) {
  process.exit(0);
}

if (!existsSync("requirements.txt")) {
  console.error("Python dependencies are missing and requirements.txt was not found.");
  process.exit(1);
}

console.log("Installing missing Python dependencies for FinTerra model service...");
const install = spawnSync(python, ["-m", "pip", "install", "-r", "requirements.txt"], {
  stdio: "inherit"
});

process.exit(install.status ?? 1);
