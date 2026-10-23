/** Litres → "200 ml" / "1.2 L". The bar reports a pour as litres ("poured 0.2"). */
export function fmtLitres(litres) {
  if (litres == null || Number.isNaN(Number(litres))) return ''
  const l = Number(litres)
  return l >= 1 ? `${Math.round(l * 100) / 100} L` : `${Math.round(l * 1000)} ml`
}

/** Seconds → "1m 12s". Shared by the Live and History view builders. */
export function fmtDuration(totalSec) {
  const s = Math.max(0, Math.round(totalSec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return r > 0 ? `${m}m ${r}s` : `${m}m`
  return `${r}s`
}
