# Streaming Agent Results Pattern

When spawning multiple agents in parallel that produce structured outputs destined for JSON files, write each result immediately as its agent completes rather than collecting all results first (batch pattern).

## Streaming Pattern (Preferred)

```javascript
const promises = agents.map(async (agent) => {
  const result = await agent;
  writeJson(result);  // write immediately when THIS one finishes
  return result;
});
await Promise.all(promises);
```

## Benefits

- Results appear incrementally (better UX for long-running operations)
- Earlier results available sooner for downstream processes
- Memory efficiency - don't hold all results in memory
- Simpler architecture - each worker is self-sufficient

## Application in MIM

This pattern was applied to the Inquisitor Swarm in run-analysis.js where each inquisitor's pending-review JSON is written immediately upon completion.

**Related files:** mim-ai/hooks/run-analysis.js
