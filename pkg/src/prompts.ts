import { Command } from './types';

export const COALESCE_COMMAND: Command = {
  name: 'coalesce',
  sessions: [
    {
      prompts: [
        `You are processing remembered knowledge. Execute this MANDATORY checklist:

1. **MUST READ** .claude/knowledge/session.md - Even if empty
2. **MUST PROCESS** each entry from session.md:
   - Determine category (architecture/patterns/dependencies/workflows/gotchas/etc)
   - **MUST CREATE OR UPDATE** appropriate file in .claude/knowledge/{category}/
   - Keep dated entries only for gotchas
3. **MUST UPDATE OR CREATE** BOTH knowledge maps:
   - **KNOWLEDGE_MAP.md** (user-facing): Use markdown links like [Topic Name](path/file.md)
   - **KNOWLEDGE_MAP_CLAUDE.md** (Claude-facing): Use RELATIVE @ references like @patterns/file.md or @gotchas/file.md (NOT full paths)
   - Both maps should have identical structure, just different link formats
   - Include last updated timestamps in user-facing map only
4. **MUST CLEAR** session.md after processing - use Write tool with empty content

**VERIFICATION CHECKLIST - ALL MUST BE TRUE:**
- [ ] Read session.md (even if empty)
- [ ] Created/updated .claude/knowledge/ category files for any new knowledge
- [ ] Created/updated BOTH KNOWLEDGE_MAP.md (markdown links) and KNOWLEDGE_MAP_CLAUDE.md (@ references)
- [ ] Verified no knowledge was lost in the transfer
- [ ] Cleared session.md by writing empty content to it

**IF YOU SKIP ANY STEP, YOU HAVE FAILED THE TASK**

IMPORTANT: CLAUDE.md uses @ references to .claude/knowledge/INSTRUCTIONS.md and .claude/knowledge/KNOWLEDGE_MAP_CLAUDE.md
IMPORTANT: KNOWLEDGE_MAP_CLAUDE.md uses RELATIVE @ references (e.g., @patterns/file.md NOT @.claude/knowledge/patterns/file.md)

Documentation structure to create and maintain:
.claude/knowledge/
|-- session.md           # Current session's raw captures (you must clear this)
|-- INSTRUCTIONS.md     # Knowledge remembering instructions (referenced by CLAUDE.md)
|-- architecture/        # System design, component relationships
|-- patterns/           # Coding patterns, conventions
|-- dependencies/       # External services, libraries
|-- workflows/          # How to do things in this project
|-- gotchas/           # Surprises, non-obvious behaviors
|-- KNOWLEDGE_MAP.md        # User-facing index with markdown links
|-- KNOWLEDGE_MAP_CLAUDE.md # Claude-facing index with RELATIVE @ references

After completing all updates, inform the user that documentation has been updated.`
      ]
    }
  ]
};

export const DISTILL_COMMAND: Command = {
  name: 'distill',
  sessions: [
    // Generate session (3 prompts)
    {
      prompts: [
        // Phase 1: Launch inquisitor agents
        `Launch parallel inquisitor agents to research each knowledge entry.

Your task:
1. Read ALL *.md files in .claude/knowledge/ EXCEPT session.md
2. For EACH substantive knowledge entry found, launch an inquisitor agent
3. Each inquisitor researches ONE specific entry to verify it against the codebase
4. Collect all their research findings

The inquisitor agents will return structured reports with:
- What I Found (current state)
- Location Context (where this knowledge belongs: global, local directory, or code comment)
- Changes Detected (recent modifications)
- Related Knowledge (similar entries)
- Observations (discrepancies/issues)

Launch as many inquisitor agents as needed to thoroughly verify the knowledge base.
Aim for comprehensive coverage of all knowledge entries, including location recommendations.`,

        // Phase 2: Process findings
        `Process all inquisitor findings and create distill-report.md.

Based on the research from all inquisitor agents:

1. **ANALYZE ALL FINDINGS**:
   - Synthesize research from all inquisitors, including their location recommendations
   - Identify exact duplicates, near-duplicates, conflicts, outdated info, junk
   - Categorize knowledge by location:
     * **Code Comment Candidates**: Very specific implementation details about a single function/class
     * **Local Knowledge**: Knowledge specific to files in a particular directory/module
     * **Global Knowledge**: Architecture, patterns, dependencies affecting multiple areas
   - Categorize issues: AUTO_FIX (clear issues) vs REQUIRES_REVIEW (ambiguous)

2. **AUTO-FIX CLEAR ISSUES**:
   - Remove exact duplicate sections
   - Delete junk/useless information
   - Fix broken references
   - Consolidate redundant information
   - Track all changes made

3. **GENERATE ./distill-report.md** with:
   ## Automated Changes
   [List all auto-fixes made with file names and descriptions]

   ## Knowledge Relocation
   ### To Code Comments
   [List entries that should become code comments]
   For each:
   - **Knowledge**: Brief description
   - **Current Location**: .claude/knowledge/...
   - **Suggested Location**: file:line where comment should go
   - **Rationale**: Why this belongs as a code comment

   <!-- USER INPUT START -->
   [Approve/modify/reject each suggestion]
   <!-- USER INPUT END -->

   ### To Local Knowledge
   [List entries that should move to subdirectory .knowledge files]
   For each:
   - **Knowledge**: Brief description
   - **Current Location**: .claude/knowledge/...
   - **Suggested Location**: subdirectory/.knowledge
   - **Rationale**: Why this is directory-specific

   <!-- USER INPUT START -->
   [Approve/modify/reject each suggestion]
   <!-- USER INPUT END -->

   ### Remains Global
   [List entries that should stay in .claude/knowledge/]
   - Brief list of topics that are truly cross-cutting

   ## Requires Review
   [List other conflicts needing human guidance]

   For each review item:
   - **Issue**: Clear description
   - **Location**: File path(s)
   - **Current State**: What exists now
   - **Options**: Suggested resolutions

   <!-- USER INPUT START -->
   [Your decisions here]
   <!-- USER INPUT END -->

4. **CRITICAL VERIFICATION**: Double-check that EVERY review item has both:
   - <!-- USER INPUT START --> delimiter before the input area
   - <!-- USER INPUT END --> delimiter after the input area
   - These delimiters MUST be present for EACH individual review item

5. Save to ./distill-report.md (repository root)
6. DO NOT commit changes`,

        // Phase 3: Edge case review
        `think hard

Review your synthesis and distill-report.md:

1. **EDGE CASE REVIEW**:
   - Check for circular duplicates (A->B->C->A)
   - Identify partial overlaps with unique info
   - Consider context-dependent accuracy
   - Look for recently deleted code references
   - Flag ambiguous references

2. **KNOWLEDGE RELOCATION VALIDATION**:
   - Verify suggested directories for local knowledge actually exist
   - Ensure code comment suggestions have valid file:line locations
   - Check for circular references (subdirectory knowledge referencing parent)
   - Validate that truly global knowledge isn't being misclassified as local
   - Consider if any knowledge might be relevant to multiple locations

3. **VALIDATION**:
   - Ensure no valuable knowledge is accidentally deleted or misplaced
   - Verify auto-fixes are truly safe
   - Double-check categorization (global vs local vs code comment)
   - Confirm all inquisitor findings were addressed

4. **USER INPUT DELIMITER VERIFICATION**:
   - CRITICAL: Verify EACH review item AND relocation suggestion has <!-- USER INPUT START --> and <!-- USER INPUT END --> delimiters
   - Each item MUST have its own pair of delimiters
   - This includes Knowledge Relocation sections
   - Fix any missing delimiters immediately

5. **REFINEMENT**:
   - Adjust relocation recommendations if needed
   - Add any missed issues
   - Improve clarity of suggestions
   - Update distill-report.md with any changes

Take your time to think through edge cases and ensure the report is thorough and accurate.`
      ]
    },
    // Refine session (1 prompt)
    {
      prompts: [
        `Execute this MANDATORY refinement process:

1. **READ DISTILL REPORT FROM ./distill-report.md**:
   - Read ./distill-report.md (repository root) completely
   - Check if there are any <!-- USER INPUT START --> ... <!-- USER INPUT END --> blocks
   - If present, parse the user's decisions/instructions from between these tags

2. **APPLY KNOWLEDGE RELOCATION DECISIONS**:
   If approved relocations exist in the Knowledge Relocation section:

   **For "To Code Comments" approved items**:
   - Note these for user to manually add (we cannot automatically modify code files)
   - Create a summary file `.claude/knowledge/CODE_COMMENTS_TODO.md` listing:
     * The knowledge content to add as comment
     * The specific file:line location
     * Suggested comment format

   **For "To Local Knowledge" approved items**:
   - Create `.knowledge` file in the specified subdirectory
   - Move the knowledge content from global to local file
   - Create or update subdirectory's `CLAUDE.md` if needed:
     * Add `@./.knowledge` reference if not already present
     * Preserve any existing CLAUDE.md content
   - Update `.gitattributes` in subdirectory to include: `*.knowledge merge=ours`
   - Remove relocated entries from global `.claude/knowledge/` files

   **Update Knowledge Maps**:
   - Update KNOWLEDGE_MAP.md to reference or exclude relocated items
   - Update KNOWLEDGE_MAP_CLAUDE.md with appropriate @ references
   - For local knowledge, optionally add references to subdirectory locations

3. **APPLY OTHER USER DECISIONS (if any)**:
   - Apply any other requested changes from "Requires Review" section
   - Knowledge files are in .claude/knowledge/ (various topic .md files)
   - Make precise edits based on user instructions

4. **DELETE THE REPORT**:
   - After successfully applying all refinements, delete ./distill-report.md
   - This indicates the refinement session is complete

5. **VERIFICATION**:
   - Ensure all approved relocations were processed correctly
   - Verify `.knowledge` files created in correct directories
   - Check subdirectory CLAUDE.md files have @ references
   - Verify consistency between KNOWLEDGE_MAP.md and KNOWLEDGE_MAP_CLAUDE.md
   - Report completion status and list all files created/modified

IMPORTANT: The report is at ./distill-report.md (repository root). Process Knowledge Relocation section first, then other changes.`
      ]
    }
  ]
};

// System prompts for different commands/phases
export const SYSTEM_PROMPTS = {
  coalesce: "You are Mím's knowledge processor. Your role is to organize raw captured knowledge into structured documentation. You must process every entry, categorize it appropriately, update knowledge maps, and ensure no knowledge is lost.",

  distillPhase1: "You are Mím's distillation orchestrator, Phase 1: Knowledge Verification. You coordinate multiple inquisitor agents to research and verify each knowledge entry against the current codebase. Launch agents systematically to ensure comprehensive coverage and location context for each entry.",

  distillPhase2: "You are Mím's distillation synthesizer, Phase 2: Finding Analysis. You process all inquisitor research to identify duplicates, conflicts, and outdated information. You also categorize knowledge by appropriate location (global, local directory, or code comment). Create a clear distill-report.md with proper USER INPUT delimiters for each review item and relocation suggestion.",

  distillPhase3: "You are Mím's distillation validator, Phase 3: Quality Assurance. You perform edge case analysis and validation of the distill report, including knowledge relocation suggestions. Ensure all USER INPUT delimiters are present, relocation paths are valid, and no valuable knowledge is lost.",

  refine: "You are Mím's refinement executor. Your role is to apply user decisions from the distill report, including knowledge relocations to subdirectory .knowledge files or code comment suggestions. Parse user input sections carefully, create local knowledge files as needed, and clean up the report when complete."
};