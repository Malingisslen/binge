'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';

// Ingenting hämtas från YouTube förrän besökaren trycker på spela: ingen
// miniatyr, bara en egen platshållare. Först vid klick laddas spelaren från
// youtube-nocookie.com. Det är så integritetspolicyn beskriver flödet
// (avsnitt 4 och 8 i src/app/integritet/page.tsx) — ändra båda tillsammans.

interface TrailerVideo {
  key: string;
  name: string;
  type: string;
}

export default function TrailerSection({ video }: { video: TrailerVideo | undefined }) {
  const [playing, setPlaying] = useState(false);

  if (!video) return null;

  return (
    <section className="detail-section">
      <div className="head">
        <h2>Trailer</h2>
        <span className="meta">YouTube · {video.type}</span>
      </div>
      <div className="raw ratio-16-9" style={{ maxWidth: 720 }}>
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.key}?autoplay=1`}
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
      {!playing && (
        <p className="text-xxs text-ink-3 mt-1">
          När du trycker på spela laddas spelaren från YouTube. Google får då din IP-adress och kan lagra
          uppgifter i din webbläsare. <Link href="/integritet/" className="text-acc-deep underline">Läs mer</Link>
        </p>
      )}
    </section>
  );
}
