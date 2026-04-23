import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-border-light mt-12 py-6 px-4 text-text-muted">
      <div className="max-w-[1024px] mx-auto flex flex-col gap-4">
        <nav aria-label="Juridisk information">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
            <li><Link href="/integritet" className="hover:text-text-primary">Integritetspolicy</Link></li>
            <li><Link href="/villkor" className="hover:text-text-primary">Villkor</Link></li>
            <li><Link href="/community-guidelines" className="hover:text-text-primary">Community-regler</Link></li>
            <li><a href="mailto:hej@binge.nu" className="hover:text-text-primary">Kontakt</a></li>
          </ul>
        </nav>
        <div className="flex items-center gap-3 text-xxs">
          <img
            src="/tmdb-logo.svg"
            alt="The Movie Database"
            width={50}
            height={20}
            loading="lazy"
            decoding="async"
          />
          <p>
            Binge använder TMDB:s API men är inte godkänd eller certifierad av
            TMDB. Filmdata från{' '}
            <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" className="hover:text-text-primary underline">
              themoviedb.org
            </a>.
          </p>
        </div>
      </div>
    </footer>
  );
}
