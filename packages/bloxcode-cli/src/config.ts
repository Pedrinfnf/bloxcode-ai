import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface AppConfig {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  mode: string;
  profile: string;
  workspace: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".bloxcode");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<AppConfig> {
  const defaults: AppConfig = {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    apiBaseUrl: "https://openrouter.ai/api/v1",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    mode: "suggest",
    profile: "safe",
    workspace: process.cwd(),
  };

  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const data = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));
    return { ...defaults, ...data, workspace: process.cwd() };
  } catch {
    return defaults;
  }
}

export async function saveConfig(config: AppConfig) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const { workspace, ...rest } = config;
  await fs.writeFile(CONFIG_FILE, JSON.stringify(rest, null, 2), "utf8");
}
