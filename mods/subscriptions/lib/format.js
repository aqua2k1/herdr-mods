export function percent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 10) / 10}%` : "—";
}
export function dateTime(value) {
  if (!Number.isFinite(value)) return "—";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function money(amount, currency) {
  return Number.isFinite(amount) ? `${currency} ${amount.toFixed(2)}` : "—";
}
