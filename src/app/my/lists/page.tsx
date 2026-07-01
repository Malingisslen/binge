'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import { useMyLists, useFollowedLists } from '@/hooks/useLists';
import { useToast } from '@/contexts/ToastContext';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';

export default function ListsPage() {
  usePageMeta({ title: 'Mina listor' });
  return <AuthGuard><ListsContent /></AuthGuard>;
}

function ListsContent() {
  const { lists, createList, deleteList } = useMyLists();
  const followed = useFollowedLists();
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
      <PageHeader
        crumb="Bibliotek · Listor"
        title="Mina listor"
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-[3px] border-none rounded-sm text-xs font-[inherit] cursor-pointer bg-acc-deep text-white"
          >
            Skapa ny lista
          </button>
        }
      />

      {showForm && (
        <div className="bg-surface border border-rule rounded-sm p-3 mb-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Listans namn"
            maxLength={100}
            className="w-full px-2 py-[3px] text-xs border border-rule rounded-sm bg-white font-[inherit] outline-none mb-2"
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Beskrivning (valfritt)"
            maxLength={300}
            rows={2}
            className="w-full px-2 py-1 text-xs border border-rule rounded-sm bg-white font-[inherit] resize-none outline-none mb-2"
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-ink-3 cursor-pointer">
              <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} className="accent-acc-deep" />
              Publik
            </label>
            <button onClick={handleCreate} className="px-3 py-[3px] text-xs border-none rounded-sm cursor-pointer bg-acc-deep text-white font-[inherit]">
              Skapa
            </button>
            <button onClick={() => setShowForm(false)} className="px-3 py-[3px] text-xs border border-rule rounded-sm cursor-pointer bg-surface text-ink-3 font-[inherit]">
              Avbryt
            </button>
          </div>
        </div>
      )}

      {lists.length === 0 && !showForm && (
        <EmptyState
          title="Inga listor ännu"
          body="Skapa en lista för att samla titlar du vill gruppera."
          action={
            <button onClick={() => setShowForm(true)} className="btn btn-acc btn-sm">
              Skapa ny lista
            </button>
          }
        />
      )}

      <div className="space-y-[6px]">
        {lists.map(list => (
          <div key={list.id} className="bg-surface border border-rule rounded-sm px-3 py-2 flex items-center justify-between">
            <div>
              <Link href={`/list/${list.id}/`} className="text-base font-semibold text-ink no-underline hover:text-acc-deep">
                {list.title}
              </Link>
              <div className="text-xs text-ink-3">
                {list.items.length} {list.items.length === 1 ? 'titel' : 'titlar'} · {list.isPublic ? 'Publik' : 'Privat'}
              </div>
            </div>
            <button
              onClick={() => { deleteList(list.id); toast('Lista borttagen'); }}
              className="px-2 py-[2px] text-xxs text-danger-ink border border-rule bg-surface rounded-sm cursor-pointer font-[inherit] hover:bg-bg-2"
            >
              Ta bort
            </button>
          </div>
        ))}
      </div>

      {followed.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xxs uppercase tracking-[0.5px] text-ink-3 font-semibold mb-2">
            Följda listor
          </h2>
          <div className="space-y-[6px]">
            {followed.map(list => (
              <Link
                key={list.id}
                href={`/list/${list.id}/`}
                className="block bg-surface border border-rule rounded-sm px-3 py-2 no-underline hover:border-rule-2 transition-colors"
              >
                <div className="text-base font-semibold text-ink">{list.title}</div>
                <div className="text-xs text-ink-3">
                  {list.items.length} {list.items.length === 1 ? 'titel' : 'titlar'}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
