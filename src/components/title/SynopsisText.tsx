'use client';

import { useState } from 'react';

/**
 * Titelns beskrivning. I mobilen kortas den till några rader med "Läs mer", så
 * att var titeln går att se syns utan att man scrollar förbi hela texten.
 * På datorn visas allt och knappen är dold (globals.css, .syn-more).
 */
// Under ungefär fyra mobilrader kortas ingenting, och då behövs ingen knapp.
const CLAMP_MIN_CHARS = 180;

export default function SynopsisText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const clampable = text.length > CLAMP_MIN_CHARS;
  return (
    <div className={`syn-wrap${open || !clampable ? ' is-open' : ''}`}>
      <p className="syn">{text}</p>
      {!open && clampable && (
        <button type="button" className="syn-more" onClick={() => setOpen(true)}>
          Läs mer
        </button>
      )}
    </div>
  );
}
