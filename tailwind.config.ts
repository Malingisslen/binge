import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        page: '#eeece8',
        surface: '#faf8f5',
        'surface-hover': '#f5f0ea',
        'sidebar-bg': '#1e2028',
        accent: '#d97b35',
        'text-primary': '#222',
        'text-secondary': '#555',
        'text-muted': '#999',
        'text-sidebar': '#9a9aaa',
        'text-sidebar-active': '#eee',
        'sidebar-label': '#3e3e48',
        'border-main': '#ddd',
        'border-light': '#eee',
        'border-table': '#f0eee8',
        'season-done': '#2e7d32',
        'cal-header': '#f5f3ee',
      },
      fontSize: {
        'xxs': '9px',
        'xs': '10px',
        'sm': '11px',
        'base': '12px',
        'md': '13px',
      },
      width: {
        'sidebar': '210px',
      },
      borderRadius: {
        'sm': '2px',
        'DEFAULT': '3px',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
export default config;
