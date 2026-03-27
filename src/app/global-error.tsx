'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="sv">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#eeece8' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#222', marginBottom: 8 }}>Något gick fel</h2>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>Ett oväntat fel uppstod.</p>
          <button
            onClick={reset}
            style={{ padding: '6px 16px', background: '#d97b35', color: '#fff', border: 'none', borderRadius: 2, fontSize: 12, cursor: 'pointer' }}
          >
            Ladda om
          </button>
        </div>
      </body>
    </html>
  );
}
