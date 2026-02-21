/**
 * Replicate — Image & Video Generation
 *
 * Wraps the Replicate REST API with polling support.
 * Gracefully skips if REPLICATE_API_TOKEN is not set.
 *
 * Commands:
 *   /imagine <prompt>  → inline keyboard to pick image model
 *   /video <prompt>    → inline keyboard to pick video model
 *
 * To add a model: add an entry to IMAGE_MODELS or VIDEO_MODELS below.
 * It will automatically appear as a button in Telegram — no other changes needed.
 */

// ============================================================
// MODEL REGISTRY
// ============================================================

export interface ModelPreset {
  /** Display label shown on the Telegram inline button */
  label: string;
  owner: string;
  name: string;
  type: "image" | "video";
  inputFn: (prompt: string) => Record<string, unknown>;
  maxWaitMs: number;
}

/**
 * Image models — add/remove entries here to change what appears in /imagine.
 */
export const IMAGE_MODELS: Record<string, ModelPreset> = {
  "flux-schnell": {
    label: "flux-schnell ⚡",
    owner: "black-forest-labs",
    name: "flux-schnell",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 60_000,
  },
  "flux-dev": {
    label: "flux-dev ✨",
    owner: "black-forest-labs",
    name: "flux-dev",
    type: "image",
    inputFn: (prompt) => ({ prompt, num_inference_steps: 28 }),
    maxWaitMs: 120_000,
  },
  "flux-2-klein-4b": {
    label: "Flux 2 Klein ⚡",
    owner: "black-forest-labs",
    name: "flux-2-klein-4b",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 60_000,
  },
  "flux-2-dev": {
    label: "Flux 2 Dev ✨",
    owner: "black-forest-labs",
    name: "flux-2-dev",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 120_000,
  },
  "flux-2-pro": {
    label: "Flux 2 Pro",
    owner: "black-forest-labs",
    name: "flux-2-pro",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 180_000,
  },
  "nano-banana": {
    label: "Nano Banana",
    owner: "google",
    name: "nano-banana",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 120_000,
  },
  "nano-banana-pro": {
    label: "Nano Banana Pro",
    owner: "google",
    name: "nano-banana-pro",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 180_000,
  },
};

/**
 * Video models — add/remove entries here to change what appears in /video.
 */
export const VIDEO_MODELS: Record<string, ModelPreset> = {
  "seedance-1-lite": {
    label: "Seedance",
    owner: "bytedance",
    name: "seedance-1-lite",
    type: "video",
    inputFn: (prompt) => ({ prompt, duration: 5 }),
    maxWaitMs: 300_000,
  },
  "ltx-2-distilled": {
    label: "LTX-2",
    owner: "lightricks",
    name: "ltx-2-distilled",
    type: "video",
    inputFn: (prompt) => ({ prompt, num_frames: 121 }),
    maxWaitMs: 180_000,
  },
  "veo-3": {
    label: "Veo 3 🔊",
    owner: "google",
    name: "veo-3",
    type: "video",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 360_000,
  },
  "veo-3.1": {
    label: "Veo 3.1 🔊",
    owner: "google",
    name: "veo-3.1",
    type: "video",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 360_000,
  },
  "veo-3.1-fast": {
    label: "Veo 3.1 Fast 🔊",
    owner: "google",
    name: "veo-3.1-fast",
    type: "video",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 300_000,
  },
  "kling-v3": {
    label: "Kling v3 Pro 🔊",
    owner: "kwaivgi",
    name: "kling-v3-video",
    type: "video",
    inputFn: (prompt) => ({ prompt, mode: "pro", duration: 5, generate_audio: true }),
    maxWaitMs: 360_000,
  },
};

const POLL_INTERVAL_MS = 5_000;

// ============================================================
// TYPES
// ============================================================

export interface GenerateResult {
  url: string;
  model: string;
  predictionId: string;
  elapsedMs: number;
}

// ============================================================
// HELPERS
// ============================================================

export function isReplicateEnabled(): boolean {
  return !!process.env.REPLICATE_API_TOKEN;
}

function getToken(): string {
  return process.env.REPLICATE_API_TOKEN || "";
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
}

/**
 * Build an inline keyboard row layout from a model map.
 * Returns rows of { text, callback_data } buttons — 2 per row.
 */
export function buildModelKeyboard(
  models: Record<string, ModelPreset>,
  callbackPrefix: string,
  prompt: string
): { text: string; callback_data: string }[][] {
  const keys = Object.keys(models);
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < keys.length; i += 2) {
    const row = keys.slice(i, i + 2).map((key) => ({
      text: models[key].label,
      // Store model key + prompt in callback_data (max 64 bytes — truncate prompt if needed)
      callback_data: truncateCallbackData(callbackPrefix, key, prompt),
    }));
    rows.push(row);
  }
  return rows;
}

/**
 * Encode model key + prompt into callback_data (64-byte Telegram limit).
 * Format: "<prefix>:<modelKey>:<prompt>"
 */
function truncateCallbackData(prefix: string, modelKey: string, prompt: string): string {
  const base = `${prefix}:${modelKey}:`;
  const maxPrompt = 64 - base.length;
  const truncated = prompt.length > maxPrompt ? prompt.slice(0, maxPrompt) : prompt;
  return `${base}${truncated}`;
}

/**
 * Parse a replicate callback_data string.
 * Returns null if it doesn't match our format.
 */
export function parseReplicateCallback(
  data: string,
  prefix: string
): { modelKey: string; prompt: string } | null {
  if (!data.startsWith(`${prefix}:`)) return null;
  const rest = data.slice(prefix.length + 1);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  return {
    modelKey: rest.slice(0, sep),
    prompt: rest.slice(sep + 1),
  };
}

// ============================================================
// PREDICTION
// ============================================================

async function createPrediction(preset: ModelPreset, prompt: string): Promise<string> {
  const url = `https://api.replicate.com/v1/models/${preset.owner}/${preset.name}/predictions`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ input: preset.inputFn(prompt) }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Replicate create failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  if (!data.id) throw new Error("Replicate: no prediction ID in response");
  return data.id as string;
}

async function pollPrediction(predictionId: string, maxWaitMs: number): Promise<string> {
  const url = `https://api.replicate.com/v1/predictions/${predictionId}`;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Replicate poll failed (${res.status})`);

    const data = await res.json();

    if (data.status === "succeeded") {
      const output = data.output;
      const outputUrl = Array.isArray(output) ? output[0] : output;
      if (!outputUrl) throw new Error("Replicate: succeeded but no output URL");
      return outputUrl as string;
    }

    if (data.status === "failed" || data.status === "canceled") {
      throw new Error(`Replicate prediction ${data.status}: ${data.error || "unknown error"}`);
    }
    // "starting" | "processing" — keep polling
  }

  throw new Error(`Replicate: timed out after ${maxWaitMs / 1000}s`);
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Generate an image using a model key from IMAGE_MODELS.
 */
export async function generateImage(
  prompt: string,
  modelKey: string
): Promise<GenerateResult> {
  if (!isReplicateEnabled()) throw new Error("REPLICATE_API_TOKEN is not set");
  const preset = IMAGE_MODELS[modelKey];
  if (!preset) throw new Error(`Unknown image model: ${modelKey}`);

  const start = Date.now();
  const predictionId = await createPrediction(preset, prompt);
  const url = await pollPrediction(predictionId, preset.maxWaitMs);
  return { url, model: modelKey, predictionId, elapsedMs: Date.now() - start };
}

/**
 * Generate a video using a model key from VIDEO_MODELS.
 */
export async function generateVideo(
  prompt: string,
  modelKey: string
): Promise<GenerateResult> {
  if (!isReplicateEnabled()) throw new Error("REPLICATE_API_TOKEN is not set");
  const preset = VIDEO_MODELS[modelKey];
  if (!preset) throw new Error(`Unknown video model: ${modelKey}`);

  const start = Date.now();
  const predictionId = await createPrediction(preset, prompt);
  const url = await pollPrediction(predictionId, preset.maxWaitMs);
  return { url, model: modelKey, predictionId, elapsedMs: Date.now() - start };
}

/**
 * Download a Replicate output URL into a Buffer.
 */
export async function downloadResult(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
