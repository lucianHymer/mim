# Claude Agent SDK Bundling Gotchas

## esbuild CJS Bundle Issue

When bundling the Claude Agent SDK with esbuild, you must pass `pathToClaudeCodeExecutable` in the query options because `import.meta.url` is not properly polyfilled in CJS bundles.

Without this, the SDK fails with the error:
```
The path argument must be of type string - Received undefined
```

**Solution**: Always provide `pathToClaudeCodeExecutable` explicitly when using esbuild to bundle your application.
