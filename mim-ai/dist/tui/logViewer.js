import * as fs from 'fs';
import * as path from 'path';
function findLogPath() {
    let dir = process.cwd();
    while (dir !== path.dirname(dir)) {
        const logPath = path.join(dir, '.claude', 'knowledge', 'mim.log');
        if (fs.existsSync(path.join(dir, '.claude', 'knowledge'))) {
            return logPath;
        }
        dir = path.dirname(dir);
    }
    return null;
}
export function createLogViewer(deps) {
    const { term, getWidth, getHeight, onClose, onCloseAndExit, onCloseAndSuspend } = deps;
    let isViewerOpen = false;
    let logLines = [];
    let scrollOffset = 0;
    function draw() {
        const width = getWidth();
        const height = getHeight();
        const visibleLines = height - 2; // header + footer
        term.clear();
        // Header - green background
        term.moveTo(1, 1);
        const lineInfo = logLines.length > 0
            ? `(${logLines.length} lines, showing ${scrollOffset + 1}-${Math.min(scrollOffset + visibleLines, logLines.length)})`
            : '(empty)';
        process.stdout.write(`\x1b[42;30m DEBUG LOG \x1b[0m \x1b[2m${lineInfo}\x1b[0m`);
        term.eraseLine();
        // Content
        for (let i = 0; i < visibleLines; i++) {
            term.moveTo(1, i + 2);
            term.eraseLine();
            const lineIdx = scrollOffset + i;
            if (lineIdx < logLines.length) {
                const line = logLines[lineIdx].substring(0, width - 1);
                process.stdout.write(`\x1b[0m${line}`);
            }
        }
        // Footer - green background with key hints
        term.moveTo(1, height);
        process.stdout.write(`\x1b[42;30m j/k:line  u/d:half  b/f:page  g/G:top/bottom  q:close  ^C:quit  ^Z:suspend \x1b[0m`);
        term.eraseLine();
    }
    function handleKey(key) {
        const height = getHeight();
        const visibleLines = height - 2;
        const halfPage = Math.floor(visibleLines / 2);
        const maxScroll = Math.max(0, logLines.length - visibleLines);
        switch (key) {
            case 'q':
            case 'ESCAPE':
                close();
                onClose();
                return;
            case 'CTRL_C':
                close();
                onCloseAndExit();
                return;
            case 'CTRL_Z':
                close();
                onCloseAndSuspend();
                return;
            case 'j':
            case 'DOWN':
                scrollOffset = Math.min(maxScroll, scrollOffset + 1);
                break;
            case 'k':
            case 'UP':
                scrollOffset = Math.max(0, scrollOffset - 1);
                break;
            case 'g':
                scrollOffset = 0;
                break;
            case 'G':
                scrollOffset = maxScroll;
                break;
            case 'u':
                scrollOffset = Math.max(0, scrollOffset - halfPage);
                break;
            case 'd':
                scrollOffset = Math.min(maxScroll, scrollOffset + halfPage);
                break;
            case 'b':
            case 'PAGE_UP':
            case 'CTRL_B':
                scrollOffset = Math.max(0, scrollOffset - visibleLines);
                break;
            case 'f':
            case 'PAGE_DOWN':
            case 'CTRL_F':
                scrollOffset = Math.min(maxScroll, scrollOffset + visibleLines);
                break;
        }
        draw();
    }
    function close() {
        isViewerOpen = false;
        logLines = [];
        scrollOffset = 0;
    }
    function open() {
        const logPath = findLogPath();
        if (!logPath || !fs.existsSync(logPath)) {
            // No log file - just show empty viewer
            logLines = ['No log file found at .claude/knowledge/mim.log'];
        }
        else {
            const content = fs.readFileSync(logPath, 'utf-8');
            logLines = content.split('\n');
        }
        // Start at the bottom of the file
        const height = getHeight();
        const visibleLines = height - 2;
        scrollOffset = Math.max(0, logLines.length - visibleLines);
        isViewerOpen = true;
        draw();
    }
    return {
        open,
        isOpen: () => isViewerOpen,
        handleKey,
    };
}
//# sourceMappingURL=logViewer.js.map