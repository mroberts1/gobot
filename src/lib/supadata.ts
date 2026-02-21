const API_BASE = "https://api.supadata.ai/v1";

export function isSupadataEnabled(): boolean {
  return !!process.env.SUPADATA_API_KEY;
}

export async function getYouTubeTranscript(url: string): Promise<{
  text: string;
  lang: string;
  availableLangs: string[];
}> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error("SUPADATA_API_KEY not set");

  const params = new URLSearchParams({ url, text: "true" });
  const res = await fetch(`${API_BASE}/youtube/transcript?${params}`, {
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as any;
    throw new Error(`Supadata ${res.status}: ${err.message || res.statusText}`);
  }

  const data = (await res.json()) as {
    content: string | unknown[];
    lang: string;
    availableLangs: string[];
  };
  const text =
    typeof data.content === "string"
      ? data.content
      : (data.content as any[]).map((c: any) => c.text || "").join(" ");

  return { text, lang: data.lang, availableLangs: data.availableLangs || [] };
}

// Extract first YouTube URL from a message
export function extractYouTubeUrl(text: string): string | null {
  const pattern =
    /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]+(?:[?&]\S*)*/i;
  const match = text.match(pattern);
  return match ? match[0] : null;
}
