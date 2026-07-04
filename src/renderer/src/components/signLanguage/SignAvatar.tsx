import { useEffect, useState, useRef } from 'react'

type SignAvatarProps = {
  poseUrl: string | null
}

async function resolveSrc(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('omi-asset://')) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error('[SignAvatar] Failed to resolve pose URL, using original:', e);
      return url;
    }
  }
  return url;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'pose-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: any; renderer?: string };
    }
  }
}

export function SignAvatar({ poseUrl }: SignAvatarProps) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewerRef = useRef<any>(null)

  useEffect(() => {
    async function init() {
      try {
        console.log('[SignAvatar] Initializing custom elements...');
        const { defineCustomElements } = await import('pose-viewer/loader');
        if (defineCustomElements) {
          await defineCustomElements();
        }
        console.log('[SignAvatar] Custom elements registered.');
        setReady(true);
      } catch (e: any) {
        console.error('[SignAvatar] Failed to initialize custom elements:', e);
        setError(e.message);
      }
    }
    init();
  }, []);

  useEffect(() => {
    async function updatePose() {
      if (viewerRef.current && poseUrl) {
        const resolvedUrl = await resolveSrc(poseUrl);
        console.log('[SignAvatar] Setting src to:', resolvedUrl);
        viewerRef.current.src = resolvedUrl;
        viewerRef.current.setAttribute('src', resolvedUrl);
      }
    }
    updatePose();
  }, [poseUrl]);


  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 text-xs italic p-4 text-center">
        Error loading viewer: {error}
      </div>
    );
  }

  if (!poseUrl) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-xs italic">
        Waiting for translation...
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-transparent">
      {ready ? (
        <pose-viewer
          ref={viewerRef}
          src={poseUrl}
          renderer="svg"
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      ) : (
        <div className="flex items-center justify-center text-xs italic text-gray-400">
          Loading pose viewer…
        </div>
      )}
      <div className="absolute top-2 left-2 text-[10px] text-white/30 pointer-events-none font-mono">
        Ready: {String(ready)} | URL: {poseUrl ? 'Yes' : 'No'}
      </div>
    </div>
  );
}
