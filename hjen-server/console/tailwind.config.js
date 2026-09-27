/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@tremor/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // HJEN graphite + warm accent (Pro DCC identity)
        ink: '#e9ebee',
        graphite: { 900: '#0b0c0e', 800: '#141619', 700: '#191c20', 600: '#20242a' },
        line: '#24272d',
        accent: { DEFAULT: '#e0a24a', dim: '#3a2e17' },
      },
    },
  },
  plugins: [],
};
