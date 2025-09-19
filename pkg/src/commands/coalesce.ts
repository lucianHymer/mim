import { runClaude } from '../claude';
import { COALESCE_COMMAND, SYSTEM_PROMPTS } from '../prompts';
import { Colors } from '../types';

/**
 * Coalesce command - Process session.md into organized documentation
 */
export async function coalesce(): Promise<void> {
  console.log('🔄 Running mim coalesce...');
  console.log('Processing remembered knowledge from session.md...');
  console.log('');

  // Get the single session with single prompt for coalesce
  const session = COALESCE_COMMAND.sessions[0];
  const prompt = session.prompts[0];

  const result = await runClaude({
    prompt,
    systemPrompt: SYSTEM_PROMPTS.coalesce
  });

  if (result.success) {
    console.log('');
    console.log('✨ Coalesce complete!');
    console.log('');
    console.log('📚 Knowledge processed and organized');
    console.log('📍 Check .claude/knowledge/ for updated documentation');
  } else {
    console.error(`${Colors.RED}❌ Coalesce failed${Colors.NC}`);
    process.exit(1);
  }
}