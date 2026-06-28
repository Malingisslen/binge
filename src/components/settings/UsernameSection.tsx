'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsSection } from './SettingsSection';
import type { ItemVisibility } from '@/types';

const VISIBILITY_OPTIONS: { value: ItemVisibility; label: string; description: string }[] = [
  { value: 'private', label: 'Privat', description: 'Bara jag ser mina titlar och min profil.' },
  { value: 'friends', label: 'Endast vänner', description: 'Bekräftade vänner ser min profil och mitt bibliotek. Andra ser inget.' },
  { value: 'public', label: 'Publik', description: 'Alla med länken till min profil kan se biblioteket och betyg.' },
];

export function UsernameSection() {
  const { user, updateUsername, updateBio, updateDefaultVisibility } = useAuth();
  const { show: toast } = useToast();
  const [usernameInput, setUsernameInput] = useState(user?.username ?? '');
  const [bioInput, setBioInput] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);

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

  return (
    <SettingsSection title="Publik profil">
      <div className="space-y-2">
        <div>
          <label className="text-xs text-ink-3 block mb-[2px]">Användarnamn</label>
          <div className="flex gap-2">
            <input
              value={usernameInput}
              onChange={e => setUsernameInput(e.target.value.toLowerCase())}
              placeholder="filmnerden"
              maxLength={20}
              className="flex-1 px-2 py-[3px] text-xs border border-rule rounded-sm bg-surface text-ink font-[inherit] outline-none"
            />
            <button
              onClick={handleSaveUsername}
              disabled={saving || usernameInput === (user.username ?? '')}
              className="btn btn-acc btn-sm disabled:opacity-50"
            >
              Spara
            </button>
          </div>
          {user.username && (
            <div className="text-xxs text-ink-3 mt-[2px]">binge.nu/user/{user.username}</div>
          )}
        </div>
        <div>
          <label className="text-xs text-ink-3 block mb-[2px]">Bio</label>
          <textarea
            value={bioInput}
            onChange={e => setBioInput(e.target.value)}
            onBlur={async () => {
              if (bioInput === user.bio) return;
              try { await updateBio(bioInput); toast('Bio sparad'); }
              catch { toast('Kunde inte spara. Försök igen om en stund.'); }
            }}
            placeholder="Berätta lite om dig…"
            maxLength={160}
            rows={2}
            className="w-full px-2 py-1 text-xs border border-rule rounded-sm bg-surface text-ink font-[inherit] resize-none outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-ink-3 block mb-[4px]">Standardsynlighet</label>
          <div className="space-y-[6px]">
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
                  className="accent-acc-deep mt-[2px] w-[13px] h-[13px] shrink-0"
                />
                <span className="leading-tight">
                  <span className="text-xs text-ink block">{opt.label}</span>
                  <span className="text-xxs text-ink-3">{opt.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
