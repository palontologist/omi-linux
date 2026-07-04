export async function resolveOmiAsset(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('omi-asset://')) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error('[resolveOmiAsset] Failed to resolve URL, using original:', e);
      return url;
    }
  }
  return url;
}
