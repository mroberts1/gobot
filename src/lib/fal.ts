/**
 * fal.ai — Image & Video Generation
 *
 * Wraps the fal.ai REST API (sync for images, async queue for videos).
 * Gracefully skips if FAL_KEY is not set.
 *
 * To add a model: add an entry to FAL_IMAGE_MODELS or FAL_VIDEO_MODELS below.
 * It will automatically appear as a button in /imagine or /video — no other changes needed.
 */

// ============================================================
// MODEL REGISTRY
// ============================================================

export interface FalModelPreset {
  /** Display label shown on the Telegram inline button */
  label: string;
  /** fal.ai model ID (used as URL path) */
  modelId: string;
  type: "image" | "video";
  inputFn: (prompt: string) => Record<string, unknown>;
  /** Max poll wait for async (video) requests */
  maxWaitMs: number;
}

/**
 * Image models — add/remove entries here to change what appears in /imagine.
 */
export const FAL_IMAGE_MODELS: Record<string, FalModelPreset> = {
  "fal-flux-2": {
    label: "Flux 2",
    modelId: "fal-ai/flux-2",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 60_000,
  },
  "fal-flux-2-max": {
    label: "Flux 2 Max",
    modelId: "fal-ai/flux-2-max",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 120_000,
  },
  "fal-nano-banana": {
    label: "Nano Banana",
    modelId: "fal-ai/nano-banana",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 60_000,
  },
  "fal-imagen4": {
    label: "Imagen 4",
    modelId: "fal-ai/imagen4/preview",
    type: "image",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 120_000,
  },
};

/**
 * Video models — add/remove entries here to change what appears in /video.
 */
export const FAL_VIDEO_MODELS: Record<string, FalModelPreset> = {
  "fal-veo3.1": {
    label: "Veo 3.1 🔊",
    modelId: "fal-ai/veo3.1",
    type: "video",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 360_000,
  },
  "fal-veo3": {
    label: "Veo 3 🔊",
    modelId: "fal-ai/veo3",
    type: "video",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 360_000,
  },
  "fal-kling3": {
    label: "Kling 3 Pro",
    modelId: "fal-ai/kling-video/v3/pro/text-to-video",
    type: "video",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 300_000,
  },
  "fal-seedance-pro": {
    label: "Seedance Pro",
    modelId: "fal-ai/bytedance/seedance/v1/pro/text-to-video",
    type: "video",
    inputFn: (prompt) => ({ prompt }),
    maxWaitMs: 300_000,
  },
};

const POLL_INTERVAL_MS = 5_000;

// ============================================================
// TYPES
// ============================================================

export interface FalGenerateResult {
  url: string;
  model: string;
  elapsedMs: number;
}

// ============================================================
// HELPERS
// ============================================================

export function isFalEnabled(): boolean {
  return !!process.env.FAL_KEY;
}

function getKey(): string {
  return process.env.FAL_KEY || "";
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Key ${getKey()}`,
  };
}

/**
 * Build inline keyboard buttons for a fal model map.
 * Returns rows of { text, callback_data } — 2 per row.
 */
export function buildFalModelKeyboard(
  models: Record<string, FalModelPreset>,
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

function truncateCallbackData(prefix: string, modelKey: string, prompt: string): string {
  const base = `${prefix}:${modelKey}:`;
  const maxPrompt = 64 - base.length;
  return `${base}${prompt.slice(0, maxPrompt)}`;
}

/**
 * Parse a fal.ai callback_data string.
 */
export function parseFalCallback(
  data: string,
  prefix: string
): { modelKey: string; prompt: string } | null {
  if (!data.startsWith(`${prefix}:`)) return null;
  const rest = data.slice(prefix.length + 1);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  return { modelKey: rest.slice(0, sep), prompt: rest.slice(sep + 1) };
}

// ============================================================
// API — IMAGES (synchronous)
// ============================================================

async function runSync(modelId: string, input: Record<string, unknown>): Promise<string> {
  const url = `https://fal.run/${modelId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai request failed (${res.status}): ${err}`);
  }

  const data = await res.json();

  // Image response: { images: [{ url }] }
  const imgUrl = data?.images?.[0]?.url || data?.image?.url || data?.output;
  if (!imgUrl) throw new Error("fal.ai: no image URL in response");
  return imgUrl as string;
}

// ============================================================
// API — VIDEOS (async queue)
// ============================================================

async function submitQueue(modelId: string, input: Record<string, unknown>): Promise<string> {
  const url = `https://queue.fal.run/${modelId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai queue submit failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const requestId = data?.request_id;
  if (!requestId) throw new Error("fal.ai: no request_id in queue response");
  return requestId as string;
}

async function pollQueue(modelId: string, requestId: string, maxWaitMs: number): Promise<string> {
  const statusUrl = `https://queue.fal.run/${modelId}/requests/${requestId}/status`;
  const resultUrl = `https://queue.fal.run/${modelId}/requests/${requestId}`;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(statusUrl, { headers: authHeaders() });
    if (!res.ok) throw new Error(`fal.ai poll failed (${res.status})`);

    const data = await res.json();
    const status = data?.status;

    if (status === "COMPLETED") {
      const resultRes = await fetch(resultUrl, { headers: authHeaders() });
      if (!resultRes.ok) throw new Error(`fal.ai result fetch failed (${resultRes.status})`);
      const result = await resultRes.json();

      // Video response: { video: { url } } or { videos: [{ url }] }
      const videoUrl =
        result?.video?.url ||
        result?.videos?.[0]?.url ||
        result?.output?.video_url ||
        result?.output;
      if (!videoUrl) throw new Error("fal.ai: no video URL in result");
      return videoUrl as string;
    }

    if (status === "FAILED") {
      throw new Error(`fal.ai video generation failed: ${data?.error || "unknown error"}`);
    }
    // IN_QUEUE | IN_PROGRESS — keep polling
  }

  throw new Error(`fal.ai: timed out after ${maxWaitMs / 1000}s`);
}

// ============================================================
// PUBLIC API
// ============================================================

export async function generateFalImage(
  prompt: string,
  modelKey: string
): Promise<FalGenerateResult> {
  if (!isFalEnabled()) throw new Error("FAL_KEY is not set");
  const preset = FAL_IMAGE_MODELS[modelKey];
  if (!preset) throw new Error(`Unknown fal image model: ${modelKey}`);

  const start = Date.now();
  const url = await runSync(preset.modelId, preset.inputFn(prompt));
  return { url, model: modelKey, elapsedMs: Date.now() - start };
}

export async function generateFalVideo(
  prompt: string,
  modelKey: string
): Promise<FalGenerateResult> {
  if (!isFalEnabled()) throw new Error("FAL_KEY is not set");
  const preset = FAL_VIDEO_MODELS[modelKey];
  if (!preset) throw new Error(`Unknown fal video model: ${modelKey}`);

  const start = Date.now();
  const requestId = await submitQueue(preset.modelId, preset.inputFn(prompt));
  const url = await pollQueue(preset.modelId, requestId, preset.maxWaitMs);
  return { url, model: modelKey, elapsedMs: Date.now() - start };
}

export async function downloadFalResult(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fal.ai download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
