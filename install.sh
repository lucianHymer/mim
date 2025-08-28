#!/bin/sh

# Mim installer script
# Usage: curl -sSL https://raw.githubusercontent.com/YOUR_REPO/main/install.sh | sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo "${RED}[ERROR]${NC} $1"
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "Not in a git repository. Please run this script from the root of your git repository."
    exit 1
fi

# Check if we're at the repository root
if [ ! -d ".git" ]; then
    log_error "Please run this script from the root of your git repository."
    exit 1
fi

log_info "Installing Mim knowledge system..."

# Base URL for downloading files
BASE_URL="https://raw.githubusercontent.com/YOUR_REPO/main/pkg"

# Create .claude directory structure
log_info "Creating .claude directory structure..."
mkdir -p .claude/knowledge
mkdir -p .claude/servers

# Download and install files
log_info "Downloading Mim components..."

# Download knowledge INSTRUCTIONS.md
curl -sSL "$BASE_URL/claude/knowledge/INSTRUCTIONS.md" -o .claude/knowledge/INSTRUCTIONS.md
log_info "Downloaded INSTRUCTIONS.md"

# Download mim.js server
curl -sSL "$BASE_URL/claude/servers/mim.js" -o .claude/servers/mim.js
log_info "Downloaded mim.js server"

# Download mim-coalesce script
curl -sSL "$BASE_URL/scripts/mim-coalesce" -o .claude/scripts/mim-coalesce
chmod +x .claude/scripts/mim-coalesce
mkdir -p .claude/scripts
mv .claude/scripts/mim-coalesce .claude/scripts/
log_info "Downloaded mim-coalesce script"

# Handle CLAUDE.md
if [ -f "CLAUDE.md" ]; then
    log_info "CLAUDE.md exists, appending Mim configuration..."
    
    # Check if Mim section already exists
    if grep -q "## 📚 Mim Knowledge System" CLAUDE.md 2>/dev/null; then
        log_warn "Mim Knowledge System section already exists in CLAUDE.md, skipping..."
    else
        # Download and append content
        echo "" >> CLAUDE.md
        curl -sSL "$BASE_URL/append-to-CLAUDE.md" >> CLAUDE.md
        log_info "Appended Mim configuration to CLAUDE.md"
    fi
else
    log_info "Creating CLAUDE.md with Mim configuration..."
    curl -sSL "$BASE_URL/append-to-CLAUDE.md" > CLAUDE.md
    log_info "Created CLAUDE.md"
fi

# Handle .gitattributes
if [ -f ".gitattributes" ]; then
    log_info ".gitattributes exists, appending Mim merge strategies..."
    
    # Check if Mim section already exists
    if grep -q "# Mim: Merge strategy for knowledge session files" .gitattributes 2>/dev/null; then
        log_warn "Mim merge strategies already exist in .gitattributes, skipping..."
    else
        # Download and append content
        echo "" >> .gitattributes
        curl -sSL "$BASE_URL/append-to-gitattributes" >> .gitattributes
        log_info "Appended Mim merge strategies to .gitattributes"
    fi
else
    log_info "Creating .gitattributes with Mim merge strategies..."
    curl -sSL "$BASE_URL/append-to-gitattributes" > .gitattributes
    log_info "Created .gitattributes"
fi

# Handle .mcp.json
if [ -f ".mcp.json" ]; then
    log_info ".mcp.json exists, merging Mim server configuration..."
    
    # Check if jq is available for JSON merging
    if command -v jq >/dev/null 2>&1; then
        # Download the mim config
        TEMP_MCP=$(mktemp)
        curl -sSL "$BASE_URL/append-to-mcp.json" -o "$TEMP_MCP"
        
        # Check if mim server already exists
        if jq -e '.mcpServers.mim' .mcp.json >/dev/null 2>&1; then
            log_warn "Mim server already configured in .mcp.json, skipping..."
            rm "$TEMP_MCP"
        else
            # Merge the configurations
            jq -s '.[0] * .[1]' .mcp.json "$TEMP_MCP" > .mcp.json.tmp && mv .mcp.json.tmp .mcp.json
            rm "$TEMP_MCP"
            log_info "Merged Mim server configuration into .mcp.json"
        fi
    else
        log_warn "jq not found. Please manually add the following to your .mcp.json:"
        echo ""
        curl -sSL "$BASE_URL/append-to-mcp.json"
        echo ""
    fi
else
    log_info "Creating .mcp.json with Mim server configuration..."
    curl -sSL "$BASE_URL/append-to-mcp.json" > .mcp.json
    log_info "Created .mcp.json"
fi

log_info "${GREEN}✓${NC} Mim installation complete!"
log_info ""
log_info "Next steps:"
log_info "  1. Review the changes: git status"
log_info "  2. Commit the changes: git add . && git commit -m 'feat: added Mim knowledge system'"
log_info "  3. Start using Mim in your Claude sessions!"
log_info ""
echo ""
echo "From the depths of Yggdrasil, a whisper rises."
echo "Huginn and Muninn take flight. 🐦‍⬛🐦‍⬛"
echo "The past whispers to the future through .claude/"
echo ""
log_info "For more information, visit: https://github.com/YOUR_REPO"
