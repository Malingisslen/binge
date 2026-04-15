'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import { useMyLists } from '@/hooks/useLists';
import { useToast } from '@/contexts/ToastContext';

export default function ListsPage() {
  return <AuthGuard><ListsContent /></AuthGuard>;
}

function ListsContent() {
  const { lists, createList, deleteList } = useMyLists();
  const { show: toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const handleCreate = async () => {
    if (!title.trim()) return;
    await createList(title.trim(), description.trim(), isPublic);
    toast('Lista skapad');
    setTitle('');
    setDescription('');
    setShowForm(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-[18px] font-bold text-text-primary">Mina listor</h1>
        <button
          onClick={() => setShowForm(true)}
          className="px-3 py-[3px] border-none rounded-sm text-xs font-[inherit] cursor-pointer bg-accent text-white"
        >
          Skapa ny lista
        </button>
      </div>

      {showForm && (
        <div className="bg-surface border border-border-main rounded-sm p-3 mb-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Listans namn"
            maxLength={100}
            className="w-full px-2 py-[3px] text-xs border border-border-main rounded-sm bg-white font-[inherit] outline-none mb-2"
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Beskrivning (valfritt)"
            maxLength={300}
            rows={2}
            className="w-full px-2 py-1 text-xs border border-border-main rounded-sm bg-white font-[inherit] resize-none outline-none mb-2"
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer">
              <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} className="accent-accent" />
              Publik
            </label>
            <button onClick={handleCreate} className="px-3 py-[3px] text-xs border-none rounded-sm cursor-pointer bg-accent text-white font-[inherit]">
              Skapa
            </button>
            <button onClick={() => setShowForm(false)} className="px-3 py-[3px] text-xs border border-border-main rounded-sm cursor-pointer bg-surface text-text-muted font-[inherit]">
              Avbryt
            </button>
          </div>
        </div>
      )}

      {lists.length === 0 && !showForm && (
        <p className="text-sm text-text-muted">Du har inga listor ännu.</p>
      )}

      <div className="space-y-[6px]">
        {lists.map(list => (
          <div key={list.id} className="bg-surface border border-border-main rounded-sm px-3 py-2 flex items-center justify-between">
            <div>
              <Link href={`/list/${list.id}/`} className="text-base font-semibold text-text-primary no-underline hover:text-accent">
                {list.title}
              </Link>
              <div className="text-xs text-text-muted">
                {list.items.length} {list.items.length === 1 ? 'titel' : 'titlar'} · {list.isPublic ? 'Publik' : 'Privat'}
              </div>
            </div>
            <button
              onClick={() => { deleteList(list.id); toast('Lista borttagen'); }}
              className="text-xxs text-red-500 bg-transparent border-none cursor-pointer font-[inherit]"
            >
              Ta bort
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
