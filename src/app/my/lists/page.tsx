'use client';

import { useState } from 'react';
import Link from 'next/link';
import AuthGuard from '@/components/AuthGuard';
import { useMyLists, useFollowedLists } from '@/hooks/useLists';
import { useToast } from '@/contexts/ToastContext';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Button } from '@/components/ui/Button';
import { fieldClass } from '@/components/ui/Field';
import { cardClass } from '@/components/ui/Card';

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
        actions={lists.length === 0 ? undefined : (
          <Button
            onClick={() => setShowForm(true)}
            variant="acc" size="sm"
          >
            Skapa ny lista
          </Button>
        )}
      />

      {showForm && (
        <div className={cardClass('p-3 mb-3')}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Listans namn"
            maxLength={100}
            className={fieldClass({ size: 'sm', className: 'w-full mb-2' })}
          />
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Beskrivning (valfritt)"
            maxLength={300}
            rows={2}
            className={fieldClass({ size: 'sm', className: 'w-full resize-none mb-2' })}
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-ink-3 cursor-pointer">
              <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} className="accent-acc-deep" />
              Publik
            </label>
            <Button onClick={handleCreate} variant="acc" size="sm">
              Skapa
            </Button>
            <Button onClick={() => setShowForm(false)} variant="ghost" size="sm">
              Avbryt
            </Button>
          </div>
        </div>
      )}

      {lists.length === 0 && !showForm && (
        <EmptyState
          title="Inga listor ännu"
          body="Skapa en lista för att samla titlar du vill gruppera."
          action={
            <Button onClick={() => setShowForm(true)} variant="acc" size="sm">
              Skapa ny lista
            </Button>
          }
        />
      )}

      <div className="space-y-1.5">
        {lists.map(list => (
          <div key={list.id} className={cardClass('px-3 py-2 flex items-center justify-between')}>
            <div>
              <Link href={`/list/${list.id}/`} className="text-base font-semibold text-ink no-underline hover:text-acc-deep">
                {list.title}
              </Link>
              <div className="text-xs text-ink-3">
                {list.items.length} {list.items.length === 1 ? 'titel' : 'titlar'} · {list.isPublic ? 'Publik' : 'Privat'}
              </div>
            </div>
            <Button
              onClick={() => { deleteList(list.id); toast('Lista borttagen'); }}
              variant="danger-ghost" size="xs"
            >
              Ta bort
            </Button>
          </div>
        ))}
      </div>

      {followed.length > 0 && (
        <div className="mt-6">
          <Eyebrow as="h2" className="mb-2">
            Följda listor
          </Eyebrow>
          <div className="space-y-1.5">
            {followed.map(list => (
              <Link
                key={list.id}
                href={`/list/${list.id}/`}
                className={cardClass('block px-3 py-2 no-underline hover:border-rule-2 transition-colors')}
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
