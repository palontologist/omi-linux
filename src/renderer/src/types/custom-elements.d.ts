import type { HTMLAttributes } from 'react'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'pose-viewer': HTMLAttributes<HTMLElement> & {
        src?: string | ArrayBuffer
        renderer?: string
      };
    }
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'pose-viewer': HTMLAttributes<HTMLElement> & {
        src?: string | ArrayBuffer
        renderer?: string
      }
    }
  }
}

export {}
