'use client';
// The caption, ready to paste: shown as text and copied with one button.
import { useState } from 'react';
import type { ReactNode } from 'react';

export function CopyCaption({ caption }: { readonly caption: string }): ReactNode {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div className="caption-box">
      <textarea
        readOnly
        value={caption}
        rows={Math.min(24, caption.split('\n').length + 1)}
        aria-label="Caption Instagram"
      />
      <p>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(caption).then(
              () => {
                setState('copied');
              },
              () => {
                setState('failed');
              },
            );
          }}
        >
          Salin caption
        </button>{' '}
        <span role="status">
          {state === 'copied' ? 'Caption tersalin.' : null}
          {state === 'failed' ? 'Gagal menyalin. Pilih teksnya lalu salin manual.' : null}
        </span>
      </p>
    </div>
  );
}
