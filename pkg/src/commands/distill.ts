import { existsSync, readFileSync, unlinkSync } from 'fs';
import { runClaude, runSession, ensureInquisitorAgent } from '../claude';
import { DISTILL_COMMAND, SYSTEM_PROMPTS } from '../prompts';
import { DistillOptions, Colors } from '../types';
import { spawn } from 'child_process';

const ALLOWED_TOOLS = 'Read,Write,Edit,MultiEdit,Glob,Grep,LS,Bash,Git';
const ALLOWED_TOOLS_WITH_TASK = `${ALLOWED_TOOLS},Task`;

/**
 * Run the distill generate phase (3 prompts in sequence)
 */
async function distillGenerate(): Promise<boolean> {
  // Ensure inquisitor agent exists
  if (!ensureInquisitorAgent()) {
    return false;
  }

  // Get the generate session (first session with 3 prompts)
  const generateSession = DISTILL_COMMAND.sessions[0];

  console.log('🔍 Starting distill generation...');
  console.log('Phase 1: Launching inquisitor agents...');
  console.log('Phase 2: Processing findings...');
  console.log('Phase 3: Edge case review...');

  // Run the entire session using the reusable function
  const result = await runSession(generateSession, {
    // First prompt uses Task tool for agents, others use regular tools
    // TODO: Consider allowing per-prompt tools configuration in runSession
    tools: ALLOWED_TOOLS_WITH_TASK,
    systemPrompts: [
      SYSTEM_PROMPTS.distillPhase1,
      SYSTEM_PROMPTS.distillPhase2,
      SYSTEM_PROMPTS.distillPhase3
    ],
    captureFirstOutput: true
  });

  if (!result.success) {
    console.error(`${Colors.RED}❌ Distill generation failed${Colors.NC}`);
    return false;
  }

  // Error if we didn't get a session ID
  if (!result.sessionId) {
    console.error(`${Colors.RED}❌ Failed to extract session ID${Colors.NC}`);
    return false;
  }

  console.log('');
  console.log('✨ Distillation complete!');

  if (existsSync('./distill-report.md')) {
    console.log('');
    console.log('📋 Distill report generated at ./distill-report.md');

    // Check if there are review items
    const report = readFileSync('./distill-report.md', 'utf-8');
    if (report.includes('## Requires Review')) {
      return true; // Success with review needed
    } else {
      console.log('   ✓ Only automatic fixes found, no manual review needed');
      return true;
    }
  }

  return true;
}

/**
 * Run the distill refine phase
 */
async function distillRefine(): Promise<void> {
  if (!existsSync('./distill-report.md')) {
    console.warn(`${Colors.YELLOW}⚠️  No distill report found at ./distill-report.md${Colors.NC}`);
    console.warn('   Run \'mim distill\' first to generate a report');
    return;
  }

  console.log('📋 Applying refinements from distill-report.md...');
  console.log('');

  // Get the refine session (second session with 1 prompt)
  const refineSession = DISTILL_COMMAND.sessions[1];
  const prompt = refineSession.prompts[0];

  const result = await runClaude({
    prompt,
    systemPrompt: SYSTEM_PROMPTS.refine
  });

  if (result.success) {
    console.log('');
    console.log('✨ Refinement complete!');
    console.log('');

    // Check if report still exists (it should be deleted after successful refine)
    if (existsSync('./distill-report.md')) {
      console.warn(`${Colors.YELLOW}⚠️  Note: distill-report.md still exists${Colors.NC}`);
      console.warn('   This might indicate the refinement was incomplete');
    } else {
      console.log('✓ All refinements applied successfully');
      console.log('✓ Distill report cleaned up');
    }
  } else {
    console.error(`${Colors.RED}❌ Refinement failed${Colors.NC}`);
    console.error('   Check distill-report.md and try again');
    process.exit(1);
  }
}

/**
 * Open editor for reviewing distill report
 */
function openEditor(editorCmd: string): void {
  console.log('');
  console.log('📝 Opening distill-report.md for your review...');
  console.log('   Please add your decisions in the <!-- USER INPUT --> sections');
  console.log('');

  const child = spawn(editorCmd, ['./distill-report.md'], {
    stdio: 'inherit',
    shell: true
  });

  child.on('error', (err) => {
    console.error(`${Colors.RED}Failed to open editor: ${err.message}${Colors.NC}`);
  });

  child.on('close', () => {
    // Editor closed, continue with refinement
  });
}

/**
 * Main distill command
 */
export async function distill(options: DistillOptions): Promise<void> {
  console.log('🧹 Running mim distill...');
  console.log('🔍 Scanning documentation for duplicates, conflicts, junk, and outdated information...');
  console.log('');
  console.log('   [This may take several minutes to analyze all documentation]');
  console.log('');

  const { noInteractive, customEditor, refineOnly } = options;

  // Determine which editor to use
  const editorCmd = customEditor || process.env.EDITOR || 'nano';

  // If --refine-only, skip directly to refine step
  if (refineOnly) {
    if (!existsSync('./distill-report.md')) {
      console.warn(`${Colors.YELLOW}⚠️  No distill-report.md found. Run 'mim distill' first.${Colors.NC}`);
      process.exit(1);
    }
    console.log('📋 Found existing distill-report.md');
    console.log('🔄 Applying refinements...');
    await distillRefine();
    return;
  }

  // Run the full distill workflow
  const generateSuccess = await distillGenerate();
  if (!generateSuccess) {
    process.exit(1);
  }

  // Handle post-generation based on mode
  if (noInteractive) {
    // Non-interactive mode
    console.log('');
    console.log(`${Colors.YELLOW}📋 Review required before applying changes${Colors.NC}`);
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Review and edit: ${Colors.BLUE}${editorCmd} ./distill-report.md${Colors.NC}`);
    console.log('  2. Add your decisions in the <!-- USER INPUT --> sections');
    console.log(`  3. Apply changes: ${Colors.BLUE}mim distill --refine-only${Colors.NC}`);
    console.log('');
    console.log(`Or use interactive mode: ${Colors.BLUE}mim distill${Colors.NC} (opens editor automatically)`);
  } else {
    // Interactive mode - open editor if review needed
    if (existsSync('./distill-report.md')) {
      const report = readFileSync('./distill-report.md', 'utf-8');
      if (report.includes('## Requires Review')) {
        await new Promise<void>((resolve) => {
          console.log('');
          console.log('📝 Opening distill-report.md for your review...');
          console.log('   Please add your decisions in the <!-- USER INPUT --> sections');
          console.log('');

          const child = spawn(editorCmd, ['./distill-report.md'], {
            stdio: 'inherit',
            shell: true
          });

          child.on('close', () => {
            resolve();
          });

          child.on('error', (err) => {
            console.error(`${Colors.RED}Failed to open editor: ${err.message}${Colors.NC}`);
            resolve();
          });
        });

        console.log('');
        console.log('🔄 Applying your refinements...');
        await distillRefine();
      } else {
        // No review needed, just auto-fixes
        console.log('');
        console.log('✨ No manual review needed - only automatic fixes were found');
        console.log('🔄 Applying automatic fixes...');
        await distillRefine();
      }
    } else {
      console.log('');
      console.log('✨ Distillation complete! No issues found.');
    }
  }
}