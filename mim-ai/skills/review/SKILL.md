---
name: review
description: Works through unresolved knowledge items with the user interactively. Use after /mim:validate to resolve ambiguous findings, or when asked to "review knowledge" or "resolve knowledge conflicts".
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, AskUserQuestion
---

# Review Unresolved Knowledge

Work through unresolved knowledge items interactively with the user.

## Steps

1. **Read unresolved items.** Read `.claude/knowledge/unresolved.md`.

2. **Check for empty state.** If the file does not exist or is empty, respond: "No unresolved items. Knowledge is clean." and stop.

3. **Handle large sets.** If there are more than 20 H2 sections, present a summary first: list the count per category and ask the user via AskUserQuestion whether to review all items, review by category, or skip.

4. **Present each item.** For each H2 section in the file:
   - Read the section content (plain prose describing the issue).
   - Read the referenced knowledge file if it still exists, for context.
   - Present the issue and options via AskUserQuestion. Derive appropriate options from the prose. Typical options: delete the entry, update the entry, keep as-is, or edit with custom changes.

5. **Handle "edit" decisions.** If the user chooses to edit, ask them what should change via AskUserQuestion. Then rewrite the knowledge entry accordingly.

6. **Apply decisions.** For each resolved item:
   - **Delete**: Remove the knowledge file and its entry from the knowledge map.
   - **Update**: Rewrite the knowledge file with corrected content.
   - **Keep as-is**: No changes to the knowledge file.
   - **Edit**: Apply the user's specified changes to the knowledge file.
   - Remove the resolved H2 section from `unresolved.md`.

7. **Clean up.** After all items are resolved, delete `unresolved.md` if it is empty.

8. **Update knowledge map.** If any entries were modified or deleted, regenerate the knowledge map from files on disk.
