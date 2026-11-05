/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // ─── Bulk design tokens ───────────────────────────────────
        ink: '#16213D',      // primary structural / text color (deep navy)
        marigold: '#F2A93B', // primary accent - CTAs, highlights
        forest: '#1F6F54',   // secondary accent - confirmed / success states
        clay: '#A8523F',     // muted brick - cancelled / warning states
        linen: '#F3EEE1',    // warm neutral background
        slate: '#5B6472',    // secondary text
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      backgroundImage: {
        perforation:
          'repeating-linear-gradient(90deg, transparent, transparent 6px, rgba(22,33,61,0.15) 6px, rgba(22,33,61,0.15) 8px)',
      },
    },
  },
  plugins: [],
};
