/** Design tokens — single source of truth for colors, spacing, radii, typography */
export const color = {
  // Neutrals
  bg: '#f5f6f8',
  surface: '#ffffff',
  border: '#e5e7eb',
  textPrimary: '#0f172a',
  textSecondary: '#6b7280',
  textTertiary: '#9ca3af',

  // Semantic — adjusted for CVD-friendliness (blue-orange safe pair)
  success: '#0b7a3e',       // darker green, good contrast
  successBg: '#e6f4ec',
  warning: '#b45309',       // amber-brown, distinct from red for CVD
  warningBg: '#fff7ed',
  danger: '#c4261a',        // high-contrast red
  dangerBg: '#fef2f2',
  info: '#0b66ff',
  infoBg: '#eff6ff',

  // UI accents
  primary: '#0b66ff',
  primaryBg: '#e0edff',
  liveDot: '#10b981',
}

export const radius = {
  sm: '6px',
  md: '10px',
  lg: '14px',
  xl: '18px',
  full: '999px',
}

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
}

export const shadow = {
  card: '0 1px 3px rgba(15,23,42,0.06)',
  elevated: '0 4px 12px rgba(15,23,42,0.08)',
}

export const font = {
  family: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  sizeXs: 'clamp(11px, 1.4vw, 12px)',
  sizeSm: 'clamp(12px, 1.6vw, 13px)',
  sizeMd: 'clamp(14px, 1.8vw, 15px)',
  sizeLg: 'clamp(16px, 2vw, 18px)',
  sizeXl: 'clamp(20px, 2.6vw, 24px)',
  sizeHero: 'clamp(28px, 3.4vw, 36px)',
  weightNormal: 400,
  weightMedium: 500,
  weightSemibold: 600,
  weightBold: 700,
}
