import React, { useEffect, useState } from 'react'
import { resolveOmiAsset } from '../../utils/assetResolver'

type SignVideoProps = {
  videoUrl: string | null
}

export function SignVideo({ videoUrl }: SignVideoProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)

  useEffect(() => {
    async function resolve() {
      if (videoUrl) {
        const resolved = await resolveOmiAsset(videoUrl);
        setResolvedUrl(resolved);
      } else {
        setResolvedUrl(null);
      }
    }
    resolve();
  }, [videoUrl]);

  if (!videoUrl || !resolvedUrl) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-xs italic">
        Waiting for translation...
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-transparent">
      <video 
        key={resolvedUrl}
        src={resolvedUrl} 
        autoPlay 
        loop 
        muted 
        playsInline
        className="w-full h-full object-contain"
        style={{ maxHeight: '100%', maxWidth: '100%' }}
        onError={(e) => console.error('[SignVideo] Video load error:', e)}
      />
    </div>
  )
}
