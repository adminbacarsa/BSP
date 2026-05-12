
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semántica abstracta para soportar cambios de tema
        background: 'var(--bg-color)',
        surface: 'var(--surface-color)',
        primary: 'var(--primary-color)',
        'text-main': 'var(--text-main)',
        'text-muted': 'var(--text-muted)',
        border: 'var(--border-color)',
        // Colores específicos para modos
        tactical: { accent: '#10b981', alert: '#f97316' },
      }
    },
  },
  plugins: [],
};
