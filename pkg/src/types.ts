export interface Session {
  prompts: string[];
}

export interface Command {
  name: string;
  sessions: Session[];
}

export interface ClaudeOptions {
  prompt: string;
  tools?: string;
  resumeSessionId?: string;
  systemPrompt?: string;
  captureOutput?: boolean;
}

export interface DistillOptions {
  noInteractive: boolean;
  customEditor?: string;
  refineOnly: boolean;
}

export const Colors = {
  RED: '\x1b[0;31m',
  GREEN: '\x1b[0;32m',
  YELLOW: '\x1b[1;33m',
  BLUE: '\x1b[0;34m',
  NC: '\x1b[0m'  // No Color
} as const;