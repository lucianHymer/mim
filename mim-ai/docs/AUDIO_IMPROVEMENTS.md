# Audio Improvements (Deferred)

This document describes a potential upgrade path for audio handling in Mim-AI.

## Current Approach

The current implementation uses the `play-sound` package, which spawns OS processes to play audio files:

```typescript
import playSound from 'play-sound';
const player = playSound({});

player.play('assets/music.wav', (err) => {
  if (err) console.error('Playback error:', err);
});
```

### Pros
- Simple to use
- No native compilation required
- Works out of the box on most systems

### Cons
- **Click artifacts**: Can cause audible clicks between music loops when one process ends and another starts
- **No volume control**: Relies on system volume; cannot programmatically adjust
- **Process overhead**: Spawns a new process for each audio file

## Proposed Solution

Use `node-speaker` combined with `pcm-volume` for streaming PCM audio with volume control.

### Dependencies
```json
{
  "speaker": "^0.5.4",
  "pcm-volume": "^1.0.0",
  "wav": "^1.0.2"
}
```

### Code Sketch

```typescript
import Speaker from 'speaker';
import { Volume } from 'pcm-volume';
import fs from 'fs';
import wav from 'wav';

class StreamingAudioPlayer {
  private speaker: Speaker | null = null;
  private volume: Volume;
  private currentLevel: number = 1.0;

  constructor() {
    this.volume = new Volume();
  }

  /**
   * Play a WAV file with seamless looping
   */
  playMusic(filePath: string, loop: boolean = false): void {
    const reader = new wav.Reader();

    reader.on('format', (format) => {
      this.speaker = new Speaker(format);

      // Set up volume control in the pipeline
      this.volume.setVolume(this.currentLevel);

      reader
        .pipe(this.volume)
        .pipe(this.speaker);

      if (loop) {
        this.speaker.on('close', () => {
          // Seamlessly restart - no process boundary = no click
          this.playMusic(filePath, true);
        });
      }
    });

    fs.createReadStream(filePath).pipe(reader);
  }

  /**
   * Adjust volume (0.0 to 1.0)
   */
  setVolume(level: number): void {
    this.currentLevel = Math.max(0, Math.min(1, level));
    this.volume.setVolume(this.currentLevel);
  }

  /**
   * Stop playback
   */
  stop(): void {
    if (this.speaker) {
      this.speaker.close(true);
      this.speaker = null;
    }
  }
}
```

### Benefits
- **Seamless loops**: No process boundary between loops eliminates click artifacts
- **Volume control**: Programmatic volume adjustment via `pcm-volume`
- **Streaming**: Memory-efficient for long audio files
- **Real-time control**: Can adjust volume mid-playback

## Trade-offs

### Native Compilation Required
`speaker` uses native bindings (via `node-gyp`) which requires:
- **Build tools**: Python, C++ compiler (gcc/clang/MSVC)
- **Platform libraries**:
  - Linux: `libasound2-dev`
  - macOS: Core Audio (included)
  - Windows: Visual Studio build tools
- **Rebuild on Node version changes**: Native modules need rebuilding

This makes the package less portable and increases installation complexity.

### When to Consider This Upgrade
- If click artifacts between music loops become problematic
- If volume control is needed for accessibility or user preference
- If the project moves to a controlled deployment environment where build tools are available

## Status

**Deferred** - The current `play-sound` approach is sufficient for now. This upgrade should be revisited if audio quality issues become a priority or if the project's deployment model changes.
