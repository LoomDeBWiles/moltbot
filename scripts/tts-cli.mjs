#!/usr/bin/env node
// tts-cli.mjs — CLI TTS tool for claude -p agent
// Replicates tts-tool.ts output: [[audio_as_voice]]\nMEDIA:/path
//
// Uses Edge TTS (mp3) + ffmpeg conversion to Opus for Telegram voice compatibility.
// Edge TTS Opus output formats are unreliable; mp3→opus via ffmpeg is robust.

import EdgeTTSModule from "node-edge-tts";
const { EdgeTTS } = EdgeTTSModule;
import { mkdtempSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";

const text = process.argv[2];
if (!text) {
  console.error("Usage: tts-cli <text>");
  process.exit(1);
}

const voice = "en-US-MichelleNeural";
const outputFormat = "audio-24khz-48kbitrate-mono-mp3";

const tts = new EdgeTTS({ voice, outputFormat, timeout: 30000 });
const tempDir = mkdtempSync(join(tmpdir(), "tts-"));
const mp3Path = join(tempDir, `voice-${Date.now()}.mp3`);
const audioPath = join(tempDir, `voice-${Date.now()}.opus`);

await tts.ttsPromise(text, mp3Path);

// Convert mp3 → opus for Telegram voice bubble compatibility
// (.opus required by isVoiceCompatibleAudio; Edge TTS opus formats are unreliable)
execFileSync("ffmpeg", ["-i", mp3Path, "-c:a", "libopus", "-b:a", "96k", "-y", audioPath], {
  stdio: "ignore",
});

const size = statSync(audioPath).size;
if (size === 0) {
  console.error("Error: ffmpeg produced empty opus file");
  process.exit(1);
}

console.log("[[audio_as_voice]]");
console.log(`MEDIA:${audioPath}`);
