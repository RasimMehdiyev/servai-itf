/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('daisyui'),
  ],
  // daisyUI v4 — a single "servai" theme whose colors mirror the CSS custom
  // properties in src/index.css (the single source of truth for the palette),
  // so daisyUI components (e.g. `progress progress-primary`) match the app.
  // base:false leaves our own global resets/background in index.css untouched.
  daisyui: {
    themes: [
      {
        servai: {
          "primary": "#2B7FFF",      // --primary
          "secondary": "#11bfb1",    // --teal
          "accent": "#11bfb1",       // --teal
          "neutral": "#0f172a",      // --text-primary
          "base-100": "#ffffff",     // --surface
          "base-200": "#f5f6f8",     // --bg
          "base-300": "#e5e7eb",     // --border
          "base-content": "#0f172a", // --text-primary
          "info": "#2B7FFF",         // --info
          "success": "#10b981",      // --success
          "warning": "#ca8a04",      // --warning
          "error": "#f43f5e",        // --danger
        },
      },
    ],
    base: false,
    styled: true,
    utils: true,
    logs: false,
  },
}
