#!/usr/bin/env node
/**
 * Run Analysis Hook for Mim
 *
 * Uses the Inquisitor pattern:
 * 1. Read all knowledge entries
 * 2. Process entries sequentially with Haiku inquisitors (one at a time, 5s delay)
 * 3. Each inquisitor investigates ONE entry against the codebase
 * 4. Auto-fixes applied inline; conflicts written as pending reviews
 * 5. Per-entry manifest tracks when each entry was last checked
 */
export {};
//# sourceMappingURL=run-analysis.d.ts.map