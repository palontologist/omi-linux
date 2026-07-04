import React from 'react'

type SignVideoProps = {
  videoUrl: string | null
}

export function SignVideo({ videoUrl }: SignVideoProps) {
  if (!videoUrl) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-xs italic">
        Waiting for translation...
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-transparent">
      <video 
        key={videoUrl}
        src={videoUrl} 
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
