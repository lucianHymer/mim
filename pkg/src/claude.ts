import { spawn } from 'child_process';
import { createWriteStream, mkdtempSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClaudeOptions, Colors, Session } from './types';
import { createInterface } from 'readline';

const ALLOWED_TOOLS = 'Read,Write,Edit,MultiEdit,Glob,Grep,LS,Bash,Git';

/**
 * Stream and process claude output from JSON-RPC format
 * Returns session ID if found in the system init message
 */
function streamClaudeOutput(line: string): string | null {
  try {
    const data = JSON.parse(line);

    // Check for session ID in system init message
    if (data.type === 'system' && data.subtype === 'init' && data.session_id) {
      return data.session_id;
    }

    // Extract and print text messages (following the example pattern)
    if (data.message?.content?.[0]?.type === 'text') {
      const text = data.message.content[0].text;
      if (text) {
        console.log(text);
      }
    }

    // Extract and print tool usage (following the example pattern)
    else if (data.message?.content?.[0]?.type === 'tool_use') {
      const toolName = data.message.content[0].name;
      if (toolName) {
        console.log(`[Using tool: ${toolName}]`);
      }
    }
  } catch {
    // If it's not valid JSON or doesn't match our expected structure,
    // just output the raw line (for backward compatibility)
    if (line.trim()) {
      console.log(line);
    }
  }

  return null;
}


/**
 * Run claude CLI with given options
 */
export async function runClaude(options: ClaudeOptions): Promise<{
  success: boolean;
  sessionId?: string;
  tempFile?: string;
}> {
  const {
    prompt,
    tools = ALLOWED_TOOLS,
    resumeSessionId,
    systemPrompt,
    captureOutput = false
  } = options;

  // Build command args
  const args: string[] = [];

  // Add resume flag if provided
  if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  }

  // Add verbose and tools
  args.push('--verbose');
  args.push('--allowedTools', tools);

  // Add system prompt if provided
  if (systemPrompt) {
    args.push('--append-system-prompt', systemPrompt);
  }

  // Add print and output format
  args.push('--print');
  args.push('--output-format', 'stream-json');
  args.push(prompt);

  return new Promise((resolve) => {
    let tempFile: string | undefined;
    let sessionId: string | undefined;
    let fullOutput = '';

    // Create temp file for capture if needed
    if (captureOutput) {
      const tempDir = mkdtempSync(join(tmpdir(), 'mim-'));
      tempFile = join(tempDir, 'output.txt');
    }

    const writeStream = tempFile ? createWriteStream(tempFile) : null;
    const child = spawn('claude', args, {
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    // Process stdout
    const rl = createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      if (captureOutput) {
        fullOutput += line + '\n';
        if (writeStream) {
          writeStream.write(line + '\n');
        }
      }
      const extractedSessionId = streamClaudeOutput(line);
      if (extractedSessionId && !sessionId) {
        sessionId = extractedSessionId;
      }
    });

    // Process stderr
    child.stderr.on('data', (data) => {
      const text = data.toString();
      if (captureOutput) {
        fullOutput += text;
        if (writeStream) {
          writeStream.write(text);
        }
      }
      process.stderr.write(data);
    });

    child.on('close', (code) => {
      if (writeStream) {
        writeStream.end();
      }

      // Session ID is now captured during streaming in the rl.on('line') handler

      resolve({
        success: code === 0,
        sessionId,
        tempFile
      });
    });

    child.on('error', (err) => {
      console.error(`${Colors.RED}Failed to start claude: ${err.message}${Colors.NC}`);
      resolve({ success: false });
    });
  });
}

/**
 * Run a complete session with multiple prompts
 */
export async function runSession(
  session: Session,
  options: {
    tools?: string;
    systemPrompts?: string[];
    captureFirstOutput?: boolean;
  } = {}
): Promise<{
  success: boolean;
  sessionId?: string;
}> {
  const {
    tools = ALLOWED_TOOLS,
    systemPrompts = [],
    captureFirstOutput = true
  } = options;

  let sessionId: string | undefined;

  // Run each prompt in the session
  for (let i = 0; i < session.prompts.length; i++) {
    const prompt = session.prompts[i];
    const systemPrompt = systemPrompts[i];

    console.log(`\n📋 Running prompt ${i + 1}/${session.prompts.length}...`);

    const result = await runClaude({
      prompt,
      tools,
      systemPrompt,
      resumeSessionId: i > 0 ? sessionId : undefined,
      captureOutput: i === 0 && captureFirstOutput
    });

    if (!result.success) {
      console.error(`${Colors.RED}❌ Prompt ${i + 1} failed${Colors.NC}`);
      return { success: false, sessionId };
    }

    // Capture session ID from first prompt
    if (i === 0 && result.sessionId) {
      sessionId = result.sessionId;
      console.log(`📝 Session ID: ${sessionId}`);
    }

    // Clean up temp file if any
    if (result.tempFile) {
      try {
        unlinkSync(result.tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  return { success: true, sessionId };
}

/**
 * Ensure the inquisitor agent exists
 */
export function ensureInquisitorAgent(): boolean {
  const fs = require('fs');
  const path = require('path');

  const agentPath = path.join(process.cwd(), '.claude', 'agents', 'inquisitor.md');
  if (!fs.existsSync(agentPath)) {
    console.warn(`${Colors.YELLOW}⚠️  Inquisitor agent not found at ${agentPath}${Colors.NC}`);
    console.warn('   Please ensure Mim is properly installed');
    return false;
  }
  return true;
}