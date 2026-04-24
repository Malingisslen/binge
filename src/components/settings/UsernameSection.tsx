'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsCard } from './SettingsCard';

export function UsernameSection() {
  const { user, updateUsername, updateBio, updateIsPublic } = useAuth();
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
    } catch { toast('Något gick fel'); }
    setSaving(false);
  };

  return (
    <SettingsCard title="Publik profil">
      <div className="space-y-2">
        <div>
          <label className="text-xs text-text-muted block mb-[2px]">Användarnamn</label>
          <div className="flex gap-2">
            <input
              value={usernameInput}
              onChange={e => setUsernameInput(e.target.value.toLowerCase())}
              placeholder="filmnerden"
              maxLength={20}
              className="flex-1 px-2 py-[3px] text-xs border border-border-main rounded-sm bg-surface text-text-primary font-[inherit] outline-none"
            />
            <button
              onClick={handleSaveUsername}
              disabled={saving || usernameInput === (user.username ?? '')}
              className="px-3 py-[3px] border-none rounded-sm text-xs font-[inherit] cursor-pointer bg-accent text-white disabled:opacity-50"
            >
              Spara
            </button>
          </div>
          {user.username && (
            <div className="text-xxs text-text-muted mt-[2px]">binge.nu/user/{user.username}</div>
          )}
        </div>
        <div>
          <label className="text-xs text-text-muted block mb-[2px]">Bio</label>
          <textarea
            value={bioInput}
            onChange={e => setBioInput(e.target.value)}
            onBlur={() => { if (bioInput !== user.bio) { updateBio(bioInput); toast('Bio sparad'); } }}
            placeholder="Berätta lite om dig..."
            maxLength={160}
            rows={2}
            className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-surface text-text-primary font-[inherit] resize-none outline-none"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-base">
          <input
            type="checkbox"
            checked={user.isPublic}
            onChange={e => { updateIsPublic(e.target.checked); toast(e.target.checked ? 'Profil publik' : 'Profil privat'); }}
            className="accent-accent w-[14px] h-[14px]"
          />
          Visa min profil publikt
        </label>
      </div>
    </SettingsCard>
  );
}
