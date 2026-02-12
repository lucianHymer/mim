#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

try {
  // Find project root by walking up to .git
  let root = process.cwd();
  while (!fs.existsSync(path.join(root, '.git'))) {
    const parent = path.dirname(root);
    if (parent === root) { root = process.cwd(); break; }
    root = parent;
  }
  const kDir = path.join(root, '.claude', 'knowledge');

  // 1. Ensure directory structure
  for (const cat of ['architecture', 'patterns', 'dependencies', 'workflows', 'gotchas'])
    fs.mkdirSync(path.join(kDir, cat), { recursive: true });

  // 2. Ensure CLAUDE.md has @ references
  const claudeMd = path.join(root, 'CLAUDE.md');
  const claudeContent = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, 'utf-8') : '';
  if (!claudeContent.includes('@.claude/knowledge/INSTRUCTIONS.md') ||
      !claudeContent.includes('@.claude/knowledge/KNOWLEDGE_MAP_CLAUDE.md')) {
    const section = '\n\n## Mim Knowledge\n\n@.claude/knowledge/INSTRUCTIONS.md\n@.claude/knowledge/KNOWLEDGE_MAP_CLAUDE.md\n';
    fs.writeFileSync(claudeMd, claudeContent + section);
  }

  // 3. Ensure .gitignore has v3 Mim entries
  const giPath = path.join(root, '.gitignore');
  const giContent = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf-8') : '';
  if (!giContent.includes('# Mim -')) {
    const block = '\n# Mim - Transient/local state files\n.claude/knowledge/unresolved.md\n.claude/knowledge/mim.log\n';
    fs.writeFileSync(giPath, giContent + block);
  }

  // 4. Count unresolved H2 sections
  let unresolvedCount = 0;
  const unresolvedPath = path.join(kDir, 'unresolved.md');
  if (fs.existsSync(unresolvedPath)) {
    const text = fs.readFileSync(unresolvedPath, 'utf-8');
    unresolvedCount = (text.match(/^## /gm) || []).length;
  }

  // 5. One-time v2 queue migration
  const queueDir = path.join(kDir, 'remember-queue');
  if (fs.existsSync(queueDir)) {
    const files = fs.readdirSync(queueDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(queueDir, file), 'utf-8')).entry;
        const safeCat = (entry.category || 'uncategorized').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'uncategorized';
        let slug = (entry.topic || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!slug) slug = 'untitled-' + Date.now();
        if (slug.length > 100) slug = slug.substring(0, 100).replace(/-$/, '');
        const catDir = path.join(kDir, safeCat);
        fs.mkdirSync(catDir, { recursive: true });
        const content = `# ${entry.topic}\n\n${entry.details}\n\n**Related files:** ${entry.files || 'none'}\n`;
        fs.writeFileSync(path.join(catDir, slug + '.md'), content);
        fs.unlinkSync(path.join(queueDir, file));
      } catch { /* skip malformed entries */ }
    }
    try { fs.rmdirSync(queueDir); } catch { /* not empty or already gone */ }
  }

  // 6. Output JSON
  const output = { hookSpecificOutput: { hookEventName: 'SessionStart' } };
  if (unresolvedCount > 0)
    output.hookSpecificOutput.additionalContext = `Mim: ${unresolvedCount} unresolved knowledge item${unresolvedCount > 1 ? 's' : ''}. Run /mim:review to resolve.`;
  console.log(JSON.stringify(output));
} catch {
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
}
