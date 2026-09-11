'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/contexts/ToastContext';
import { SettingsSection } from './SettingsSection';
import { MAX_DISPLAY_NAME } from '@/lib/clampText';

export function ProfileSection() {
  const { user, signOut, updateDisplayName } = useAuth();
  const { show: toast } = useToast();
  const [nameInput, setNameInput] = useState(user?.displayName ?? '');
  if (!user) return null;

  // BIN-1154: namnet gick tidigare inte att ändra någonstans i appen. Det sattes
  // en gång — vid registreringen eller från Google-kontot — och stod sedan kvar.
  //
  // Sparar på blur, som bio-fältet bredvid. Bekräftelsen är gatad på att
  // `updateDisplayName` inte kastade: skrivvägen KAN vägra, och en ovillkorlig
  // toast hade gjort varje vägran till en lögn.
  //
  // Vid vägran återställs fältet synligt till det senast sparade namnet. Toasten
  // lever bara ett par sekunder, så fältet — inte toasten — är den bestående
  // signalen om att ingenting sparades.
  async function saveName() {
    const next = nameInput.trim();
    if (next === user!.displayName) return;
    if (!next) {
      setNameInput(user!.displayName);
      toast('Namnet kan inte vara tomt.');
      return;
    }
    try {
      await updateDisplayName(next);
      toast('Namnet sparat');
    } catch {
      setNameInput(user!.displayName);
      toast('Kunde inte spara. Försök igen om en stund.');
    }
  }

  return (
    <SettingsSection title="Profil">
      <label htmlFor="displayName" className="block text-xs text-ink-3 mb-1">
        Namn
      </label>
      <input
        id="displayName"
        type="text"
        autoComplete="nickname"
        aria-describedby="displayName-help"
        maxLength={MAX_DISPLAY_NAME}
        value={nameInput}
        onChange={e => setNameInput(e.target.value)}
        onBlur={saveName}
        className="w-full px-2 py-1 text-base border border-rule rounded-sm bg-surface text-ink font-[inherit] outline-none focus:border-acc-deep"
      />
      <p id="displayName-help" className="text-xxs text-ink-3 mt-1">
        Visas för andra användare i appen, till exempel i notiser och på din profil.
        Max {MAX_DISPLAY_NAME} tecken.
      </p>

      <div className="text-base mt-3">
        <span className="text-ink-3 text-xs mr-2">E-post:</span>
        {user.email}
      </div>
      <button onClick={signOut} className="btn btn-ghost btn-sm mt-3">
        Logga ut
      </button>
    </SettingsSection>
  );
}
