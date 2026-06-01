import type { Config } from "tailwindcss";

// Direction H · "Schemat" tokens. All colour values are CSS variables
// declared in src/app/globals.css :root — so a theme swap means changing
// the CSS, not the Tailwind config.
//
// Two-accent rule (strict — do not mix):
//   acc-*  (saffran) → "now / live / decisive"  (CTA, tonight, veto, brand)
//   cal-*  (plum)    → "today / picker / time-position"
//
// Legacy aliases (page, surface, accent, text-primary, text-secondary,
// text-muted, border-main, border-light) are kept and remapped to the new
// values so existing pages inherit the new look without component-by-
// component edits. They will be removed once every page is migrated to the
// Direction-H component vocabulary.
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Direction H · primary token names
        bg: 'var(--bg)',
        'bg-2': 'var(--bg-2)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        rule: 'var(--rule)',
        'rule-2': 'var(--rule-2)',

        // Saffran — live/now/decisive
        acc: 'var(--acc)',
        'acc-deep': 'var(--acc-deep)',
        'acc-soft': 'var(--acc-soft)',

        // Plum — today/picker/time-position
        'cal-deep': 'var(--cal-deep)',
        'cal-soft': 'var(--cal-soft)',

        // Warn — yellow advisory (legal disclaimers, soft warnings)
        'warn-soft': 'var(--warn-soft)',
        'warn-deep': 'var(--warn-deep)',
        'warn-ink': 'var(--warn-ink)',

        // Danger — destructive / error (not part of the two-accent rule)
        danger: 'var(--danger)',
        'danger-soft': 'var(--danger-soft)',
        'danger-ink': 'var(--danger-ink)',

        // Duotone — for use in legends, swatches, pill bars (the duotone
        // image filters themselves are SVG <filter>s, see DuotoneFilters).
        'duo-terra': 'var(--duo-terra)',
        'duo-slate': 'var(--duo-slate)',
        'duo-moss': 'var(--duo-moss)',
        'duo-clay': 'var(--duo-clay)',
        'duo-plum': 'var(--duo-plum)',
        'duo-steel': 'var(--duo-steel)',
        'duo-olive': 'var(--duo-olive)',
        'duo-oxblood': 'var(--duo-oxblood)',

        // ─── Legacy bridge — remapped to Direction-H tokens ───
        page: 'var(--bg)',
        'surface-hover': 'var(--bg-2)',
        accent: 'var(--acc-deep)',
        'text-primary': 'var(--ink)',
        'text-secondary': 'var(--ink-2)',
        'text-muted': 'var(--ink-3)',
        'border-main': 'var(--rule)',
        'border-light': 'var(--rule-2)',
        'border-table': 'var(--rule-2)',
        'cal-header': 'var(--bg-2)',
        'season-done': 'oklch(0.55 0.13 145)',
        // sidebar-bg kept — still used in src/app/page.tsx (landing hero section).
        'sidebar-bg': 'var(--ink)',
      },
      fontFamily: {
        sans: ['Albert Sans', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Direction H bumps the base — pages now read at 15px.
        'xxs': '10px',
        'xs': '11px',
        'sm': '12.5px',
        'base': '13.5px',
        'md': '14px',
        'lg': '15.5px',
      },
      maxWidth: {
        canvas: '1320px',
      },
      borderRadius: {
        'sm': '3px',
        'DEFAULT': '6px',
        'md': '6px',
        'lg': '8px',
      },
      boxShadow: {
        // Two allowed shadows. Everything else stays flat.
        'lift':   '0 4px 14px oklch(0 0 0 / 0.06)',
        'pop':    '0 2px 8px oklch(0 0 0 / 0.04)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-acc': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'pulse-acc': 'pulse-acc 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
