'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import Sidebar from './Sidebar';

export default function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-2 left-2 z-50 bg-sidebar-bg text-white p-2 rounded-sm border-none cursor-pointer"
        aria-label="Meny"
      >
        <Menu size={18} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-sidebar">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 text-text-sidebar bg-transparent border-none cursor-pointer z-10"
              aria-label="Stäng"
            >
              <X size={16} />
            </button>
            <Sidebar onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </>
  );
}
