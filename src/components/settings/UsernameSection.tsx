'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsSection } from './SettingsSection';
import type { ItemVisibility } from '@/types';
import { MAX_BIO } from '@/lib/clampText';
import { Button } from '@/components/ui/Button';
import { fieldClass } from '@/components/ui/Field';

const VISIBILITY_OPTIONS: { value: ItemVisibility; label: string; description: string }[] = [
  { value: 'private', label: 'Privat', description: 'Bara jag ser mina titlar.' },
  { value: 'friends', label: 'Endast vänner', description: 'Bekräftade vänner ser min profil och mitt bibliotek.' },
  { value: 'public', label: 'Publik', description: 'Alla med länken till min profil kan se biblioteket och betyg.' },
];

export function UsernameSection() {
  const { user, updateUsername, updateBio, updateDefaultVisibility, visibilitySyncPending } = useAuth();
  const { show: toast } = useToast();
  const [usernameInput, setUsernameInput] = useState(user?.username ?? '');
  const [bioInput, setBioInput] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [retryingVisibility, setRetryingVisibility] = useState(false);

  if (!user) return null;

  const handleSaveUsername = async () => {
    const { validateUsername, isUsernameAvailable } = await import('@/lib/firebase/username');
    const error = validateUsername(usernameInput);
    if (error) { toast(error); return; }
    if (usernameInput === user.username) return;
    const available = await isUsernameAvailable(usernameInput);
    if (!available) { toast('Användarnamnet är redan taget'); return; }
    setSaving(true);
    try {
      await updateUsername(usernameInput);
      toast('Användarnamn sparat');
    } catch { toast('Kunde inte spara. Försök igen om en stund.'); }
    setSaving(false);
  };

  // BIN-587: manuell reparation av en synlighets-ändring som bara hann spara
  // profilen. Kör om SAMMA värde — steg 2 (stämplingen av varje titel) är det
  // som saknas, och lyckas den rensas varningen.
  const handleRetryVisibility = async () => {
    setRetryingVisibility(true);
    try {
      await updateDefaultVisibility(user.defaultVisibility);
    } catch { toast('Kunde inte spara. Försök igen om en stund.'); }
    setRetryingVisibility(false);
  };

  return (
    <SettingsSection title="Publik profil">
      <div className="space-y-2">
        <div>
          <label htmlFor="username" className="text-xs text-ink-3 block mb-0.5">Användarnamn</label>
          <div className="flex gap-2">
            <input
              id="username"
              // BIN-1169: `username` means the LOGIN identity in the autofill spec, and
              // Binge logs in with email, so a password manager could fill the login
              // email here. This is the public handle, which nothing should autofill.
              autoComplete="off"
              aria-describedby={user.username ? 'username-help' : undefined}
              value={usernameInput}
              onChange={e => setUsernameInput(e.target.value.toLowerCase())}
              placeholder="filmnerden"
              maxLength={20}
              className={fieldClass({ size: 'sm', className: 'flex-1' })}
            />
            <Button
              onClick={handleSaveUsername}
              disabled={saving || usernameInput === (user.username ?? '')}
              variant="acc" size="sm" className="disabled:opacity-50"
            >
              Spara
            </Button>
          </div>
          {user.username && (
            <div id="username-help" className="text-xxs text-ink-3 mt-0.5">binge.nu/user/{user.username}</div>
          )}
        </div>
        <div>
          <label htmlFor="bio" className="text-xs text-ink-3 block mb-0.5">Bio</label>
          <textarea
            id="bio"
            value={bioInput}
            onChange={e => setBioInput(e.target.value)}
            onBlur={async () => {
              if (bioInput === user.bio) return;
              // Skriv bara tillbaka om faltet fortfarande haller det som skickades -
              // text som skrevs medan sparningen pagick far inte skrivas over.
              const sent = bioInput;
              try {
                const stored = await updateBio(sent);
                setBioInput(prev => (prev === sent ? stored : prev));
                toast('Bio sparad');
              }
              catch { toast('Kunde inte spara. Försök igen om en stund.'); }
            }}
            placeholder="Berätta lite om dig…"
            maxLength={MAX_BIO}
            rows={2}
            className={fieldClass({ size: 'sm', className: 'w-full resize-none' })}
          />
        </div>
        <div>
          <span id="defaultVisibility-label" className="text-xs text-ink-3 block mb-1">Standardsynlighet</span>
          <div role="radiogroup" aria-labelledby="defaultVisibility-label" className="space-y-1.5">
            {VISIBILITY_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="defaultVisibility"
                  value={opt.value}
                  checked={user.defaultVisibility === opt.value}
                  onChange={async () => {
                    try {
                      await updateDefaultVisibility(opt.value);
                      toast(`Standardsynlighet: ${opt.label.toLowerCase()}`);
                    } catch { toast('Kunde inte spara. Försök igen om en stund.'); }
                  }}
                  className="accent-acc-deep mt-0.5 w-[13px] h-[13px] shrink-0"
                />
                <span className="leading-tight">
                  <span className="text-xs text-ink block">{opt.label}</span>
                  <span className="text-xxs text-ink-3">{opt.description}</span>
                </span>
              </label>
            ))}
          </div>
          {/* BIN-1244: juridik- och dataskyddsrollernas villkor — valet ska själv säga vem
              mer som kan se profilen. Malin valde lydelsen 2026-09-18. */}
          <p className="text-xxs text-ink-3 mt-1.5">
            Administratörer kan se namn, användarnamn, bild och presentation vid en anmälan.
          </p>
          {visibilitySyncPending && (
            <div className="mt-1.5 border border-danger bg-danger-soft rounded-sm px-2 py-1.5">
              <p className="text-xxs text-danger-ink leading-snug">
                Synligheten är sparad på din profil men hann inte uppdateras på alla dina
                titlar — några kan fortfarande visas enligt din tidigare inställning.
                Binge försöker igen nästa gång du öppnar appen.
              </p>
              <Button
                onClick={handleRetryVisibility}
                disabled={retryingVisibility}
                variant="danger-ghost" size="sm" className="mt-1 disabled:opacity-50"
              >
                {retryingVisibility ? 'Försöker…' : 'Försök igen nu'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
