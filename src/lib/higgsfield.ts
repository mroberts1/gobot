/**
 * Higgsfield — Text-to-Image & Image-to-Video Generation
 *
 * API base: https://platform.higgsfield.ai
 * Auth: Authorization: Key {api_key}:{api_secret}
 *
 * Commands:
 *   /hf <prompt>           → text-to-image model picker
 *   Photo + caption /hf    → image-to-video model picker
 *
 * To add models: add entries to HF_IMAGE_MODELS or HF_VIDEO_MODELS below.
 */

// ============================================================
// MODEL REGISTRY
// ============================================================

export interface HfModelPreset {
  label: string;
  modelId: string;
  type: "image" | "video";
  inputFn: (prompt: string, imageUrl?: string) => Record<string, unknown>;
  maxWaitMs: number;
}

export const HF_IMAGE_MODELS: Record<string, HfModelPreset> = {
  "soul-standard": {
    label: "Soul 720p",
    modelId: "higgsfield-ai/soul/standard",
    type: "image",
    inputFn: (prompt) => ({ prompt, aspect_ratio: "16:9", resolution: "720p" }),
    maxWaitMs: 120_000,
  },
  "soul-1080p": {
    label: "Soul 1080p",
    modelId: "higgsfield-ai/soul/standard",
    type: "image",
    inputFn: (prompt) => ({ prompt, aspect_ratio: "16:9", resolution: "1080p" }),
    maxWaitMs: 180_000,
  },
  "reve-image": {
    label: "Reve",
    modelId: "reve/text-to-image",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 120_000,
  },
};

export const HF_VIDEO_MODELS: Record<string, HfModelPreset> = {
  "dop-standard": {
    label: "DoP Standard",
    modelId: "higgsfield-ai/dop/standard",
    type: "video",
    inputFn: (prompt, imageUrl) => ({ image_url: imageUrl, prompt, duration: 5 }),
    maxWaitMs: 300_000,
  },
  "dop-preview": {
    label: "DoP Preview",
    modelId: "higgsfield-ai/dop/preview",
    type: "video",
    inputFn: (prompt, imageUrl) => ({ image_url: imageUrl, prompt, duration: 5 }),
    maxWaitMs: 180_000,
  },
  "seedance-pro-i2v": {
    label: "Seedance Pro",
    modelId: "bytedance/seedance/v1/pro/image-to-video",
    type: "video",
    inputFn: (prompt, imageUrl) => ({ image_url: imageUrl, prompt, duration: 5 }),
    maxWaitMs: 300_000,
  },
  "kling-v2-pro-i2v": {
    label: "Kling v2.1 Pro",
    modelId: "kling-video/v2.1/pro/image-to-video",
    type: "video",
    inputFn: (prompt, imageUrl) => ({ image_url: imageUrl, prompt, duration: 5 }),
    maxWaitMs: 300_000,
  },
};

// ============================================================
// TYPES
// ============================================================

export interface HfGenerateResult {
  url: string;
  model: string;
  elapsedMs: number;
}

// ============================================================
// HELPERS
// ============================================================

export function isHfEnabled(): boolean {
  return !!(process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_SECRET);
}

const API_BASE = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 5_000;

function authHeader(): string {
  return `Key ${process.env.HIGGSFIELD_API_KEY}:${process.env.HIGGSFIELD_API_SECRET}`;
}

function truncateCallbackData(prefix: string, key: string, prompt: string): string {
  const base = `${prefix}:${key}:`;
  const maxPrompt = 64 - base.length;
  return base + prompt.substring(0, maxPrompt);
}

export function parseHfCallback(
  data: string,
  prefix: string
): { modelKey: string; prompt: string } | null {
  const withoutPrefix = data.substring(prefix.length + 1);
  const colonIdx = withoutPrefix.indexOf(":");
  if (colonIdx === -1) return null;
  return {
    modelKey: withoutPrefix.substring(0, colonIdx),
    prompt: withoutPrefix.substring(colonIdx + 1),
  };
}

export function buildHfModelKeyboard(
  models: Record<string, HfModelPreset>,
  callbackPrefix: string,
  prompt: string
): { text: string; callback_data: string }[][] {
  const keys = Object.keys(models);
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < keys.length; i += 2) {
    const row = keys.slice(i, i + 2).map((key) => ({
      text: models[key].label,
      callback_data: truncateCallbackData(callbackPrefix, key, prompt),
    }));
    rows.push(row);
  }
  return rows;
}

// ============================================================
// GENERATION
// ============================================================

async function submitRequest(
  modelId: string,
  body: Record<string, unknown>
): Promise<string> {
  const res = await fetch(`${API_BASE}/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Higgsfield submit ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { request_id?: string; id?: string };
  const requestId = data.request_id || data.id;
  if (!requestId) throw new Error(`No request_id in response: ${JSON.stringify(data)}`);
  return requestId;
}

async function pollStatus(
  requestId: string,
  maxWaitMs: number
): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(`${API_BASE}/requests/${requestId}/status`, {
      headers: { Authorization: authHeader(), Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
    const data = (await res.json()) as {
      status: string;
      output?: { url?: string }[] | { url?: string };
      url?: string;
    };

    if (data.status === "completed") {
      // Extract URL from various response shapes
      if (typeof data.output === "string") return data.output;
      if (data.url) return data.url;
      if (Array.isArray(data.output) && data.output[0]?.url) return data.output[0].url;
      if (!Array.isArray(data.output) && data.output?.url) return data.output.url;
      throw new Error(`Completed but no URL in response: ${JSON.stringify(data)}`);
    }
    if (data.status === "failed") throw new Error("Generation failed");
    if (data.status === "nsfw") throw new Error("Content flagged as NSFW");
  }
  throw new Error(`Timed out after ${maxWaitMs / 1000}s`);
}

export async function generateHfImage(
  prompt: string,
  modelKey: string
): Promise<HfGenerateResult> {
  const preset = HF_IMAGE_MODELS[modelKey];
  if (!preset) throw new Error(`Unknown image model: ${modelKey}`);
  const start = Date.now();
  const requestId = await submitRequest(preset.modelId, preset.inputFn(prompt));
  const url = await pollStatus(requestId, preset.maxWaitMs);
  return { url, model: modelKey, elapsedMs: Date.now() - start };
}

export async function generateHfVideo(
  prompt: string,
  modelKey: string,
  imageUrl: string
): Promise<HfGenerateResult> {
  const preset = HF_VIDEO_MODELS[modelKey];
  if (!preset) throw new Error(`Unknown video model: ${modelKey}`);
  const start = Date.now();
  const requestId = await submitRequest(preset.modelId, preset.inputFn(prompt, imageUrl));
  const url = await pollStatus(requestId, preset.maxWaitMs);
  return { url, model: modelKey, elapsedMs: Date.now() - start };
}

export async function downloadHfResult(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
