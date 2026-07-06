use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub api_key: String,
    pub api_base_url: String,
    pub model: String,
    pub mode: Mode,
    pub profile: Profile,
    pub workspace: PathBuf,
    pub reasoning_level: ReasoningLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Suggest,
    AutoEdit,
    FullAuto,
    Plan,
    Scout,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    Safe,
    Edit,
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningLevel {
    Off,
    Low,
    Medium,
    High,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            api_base_url: "https://openrouter.ai/api/v1".into(),
            model: "nvidia/nemotron-3-ultra-550b-a55b:free".into(),
            mode: Mode::Suggest,
            profile: Profile::Safe,
            workspace: std::env::current_dir().unwrap_or_default(),
            reasoning_level: ReasoningLevel::Off,
        }
    }
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        let home = dirs_path();
        let path = home.join("config.json");
        if path.exists() {
            let data = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&data)?)
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let home = dirs_path();
        std::fs::create_dir_all(&home)?;
        let path = home.join("config.json");
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}

fn dirs_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".bloxcode")
}
