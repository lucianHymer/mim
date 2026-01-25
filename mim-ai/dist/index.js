#!/usr/bin/env node
export { printTitleArt, showTitleScreen, getTitleArt } from './tui/title-screen.js';
export { startGame, MimGame } from './tui/main.js';
// When run directly, show the title
import { printTitleArt } from './tui/title-screen.js';
printTitleArt();
console.log('  v2.0.0\n');
//# sourceMappingURL=index.js.map