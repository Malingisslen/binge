'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';

// M1: trailer-sektionen renderade en trasig-bild-låda när YouTube-videon var
// borttagen/otillgänglig. Vi visar nu en klick-för-att-spela-facade med
// YouTube-thumbnailen; först vid klick laddas iframen. Om thumbnailen 404:ar
// (onError) eller YouTube returnerar sin grå 120×90-placeholder (videon finns
// inte längre) döljer vi hela sektionen — hellre ingen trailer än en trasig.

interface TrailerVideo {
  key: string;
  name: string;
  type: string;
}

export default function TrailerSection({ video }: { video: TrailerVideo | undefined }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!video || failed) return null;

  return (
    <section className="detail-section">
      <div className="head">
        <h2>Trailer</h2>
        <span className="meta">YouTube · {video.type}</span>
      </div>
      <div className="raw ratio-16-9" style={{ maxWidth: 720 }}>
        {playing ? (
          <iframe
            src={`https://www.youtube.com/embed/${video.key}?autoplay=1`}
            title={video.name}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Spela trailer: ${video.name}`}
            style={{
              position: 'relative',
              display: 'block',
              width: '100%',
              height: '100%',
              padding: 0,
              border: 0,
              cursor: 'pointer',
              background: 'var(--placeholder-fill)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://i.ytimg.com/vi/${video.key}/hqdefault.jpg`}
              alt=""
              width={480}
              height={270}
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
              onLoad={e => {
                // YouTube svarar 200 med en grå 120×90-default när videon
                // saknas — behandla det som "ingen användbar trailer".
                if (e.currentTarget.naturalWidth <= 120) setFailed(true);
              }}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 48,
                  height: 48,
                  borderRadius: 6,
                  background: 'oklch(0 0 0 / 0.6)',
                  color: 'oklch(1 0 0)',
                }}
              >
                <Play size={20} fill="currentColor" />
              </span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
