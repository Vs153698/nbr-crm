import type { Config } from 'tailwindcss';

/**
 * Design tokens from the approved NBR design system (§11 of the plan).
 * Every colour, radius and shadow used anywhere in the product is declared
 * here — no component invents its own hex value.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0E1B3D',
          soft: '#1B2C55',
          hover: '#22376A',
        },
        brand: {
          DEFAULT: '#2557D6',
          hover: '#1E48B8',
          tint: '#EAF0FD',
          ring: '#B7CCF7',
        },
        canvas: '#F2F5FA',
        line: '#E1E7F0',
        ink: {
          DEFAULT: '#10182B',
          2: '#47536B',
          3: '#7A869E',
          4: '#A3AEC2',
        },
        // Semantic families — same colour means the same thing everywhere.
        ok: { DEFAULT: '#10893E', tint: '#E7F5EC', ring: '#B7E3C6' },
        warn: { DEFAULT: '#B36A00', tint: '#FDF2E2', ring: '#F0D7A8' },
        danger: { DEFAULT: '#C7362F', tint: '#FCEDEC', ring: '#F2BFBC' },
        info: { DEFAULT: '#2557D6', tint: '#EAF0FD', ring: '#B7CCF7' },
        purple: { DEFAULT: '#6D3BD1', tint: '#F1EBFD', ring: '#D2BEF5' },
        teal: { DEFAULT: '#0E7C86', tint: '#E4F4F5', ring: '#A9DDE1' },
        gold: { DEFAULT: '#C08A2E', tint: '#FBF3E2', ring: '#EAD3A0' },
        slate2: { DEFAULT: '#64748B', tint: '#EEF1F6', ring: '#CBD4E1' },

        /**
         * NBR brand palette, taken from the public site and the logo artwork
         * rather than invented here: the deep navy and the orange are the two
         * colours the organisation already uses in public.
         *
         * Flat values only — the brand does not use gradients, so none are
         * defined. Being applied page by page; the login screen is the first.
         */
        nbr: {
          // Page background, and the dot grid that sits on it.
          bg: '#0D1B2A',
          dot: '#1B2C3D',
          // Panel surfaces, lightest last.
          surface: '#10202F',
          raised: '#16293A',
          // Hairlines. `edge` is for focus and hover, where a border must read.
          line: '#1E3549',
          edge: '#2B4763',
          orange: {
            DEFAULT: '#E8823C',
            hover: '#D4712C',
            // For tinted fills and focus rings on dark surfaces.
            soft: '#3A2418',
            ring: '#7A4A22',
          },
          // The seal's navy, for artwork sitting on light backgrounds.
          seal: '#1E2F4B',
          text: {
            DEFAULT: '#FFFFFF',
            2: '#B4C4D4',
            3: '#8098B0',
            4: '#5C7188',
          },
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SF Mono', 'JetBrains Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        card: '10px',
        panel: '14px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,43,.06), 0 1px 3px rgba(16,24,43,.05)',
        raised: '0 4px 12px rgba(16,24,43,.07), 0 1px 3px rgba(16,24,43,.05)',
        pop: '0 12px 32px rgba(16,24,43,.12)',
        modal: '0 24px 64px rgba(16,24,43,.20)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .15s ease-out',
        'slide-up': 'slide-up .22s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in .16s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
