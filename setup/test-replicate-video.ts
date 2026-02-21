/**
 * Quick test: generate a video with a Replicate video model.
 * Usage: bun run setup/test-replicate-video.ts [modelKey] [prompt]
 *
 * modelKey defaults to "veo-3.1-fast"
 * prompt defaults to a short cinematic scene
 */

import { generateVideo, VIDEO_MODELS } from "../src/lib/replicate";
import { loadEnv } from "../src/lib/env";

loadEnv();

const modelKey = process.argv[2] ?? "veo-3.1-fast";
const prompt =
  process.argv.slice(3).join(" ") ||
  "A lone lighthouse on a rocky cliff at sunset, waves crashing below, golden hour light, cinematic";

if (!VIDEO_MODELS[modelKey]) {
  console.error(`Unknown model key: "${modelKey}"`);
  console.error("Available models:", Object.keys(VIDEO_MODELS).join(", "));
  process.exit(1);
}

const model = VIDEO_MODELS[modelKey];
console.log(`\nModel   : ${model.label} (${model.owner}/${model.name})`);
console.log(`Prompt  : ${prompt}`);
console.log(`Timeout : ${model.maxWaitMs / 1000}s\n`);
console.log("Starting prediction...");

const t0 = Date.now();

try {
  const result = await generateVideo(prompt, modelKey);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ Done in ${elapsed}s`);
  console.log(`Prediction ID : ${result.predictionId}`);
  console.log(`Video URL     : ${result.url}`);
} catch (err) {
  console.error(`\n❌ Failed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
