// ═══════════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS — Strong types for the entire system
// ═══════════════════════════════════════════════════════════════════════════════

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolCall {
  type: "tool";
  tool: string;
  args: Record<string, unknown>;
}

export interface FinalResponse {
  type: "final";
  content: string;
}

export type LLMResponse = ToolCall | FinalResponse;

export interface ToolResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  args: string[];
  category: "fs" | "shell" | "git" | "web" | "mcp" | "custom";
  fn: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface MCPServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
  };
}

export interface SessionInfo {
  id: string;
  title: string;
  messages: number;
  created: number;
}

export interface StreamResult {
  content: string;
  reasoning: string;
  isJson: boolean;
  wasStreamed: boolean;
  usage: TokenUsage | null;
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export type Mode = "suggest" | "autoedit" | "fullauto" | "plan" | "scout";
export type Profile = "safe" | "edit" | "full";
export type ReasoningLevel = "off" | "low" | "medium" | "high";

export interface Config {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  mode: Mode;
  profile: Profile;
  reasoningLevel: ReasoningLevel;
  workspace: string;
}
