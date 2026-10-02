// Same palette as the web scanner (apps/web/app/globals.css, "Scanner").
export const colors = {
  bg: '#10191c',
  card: '#182428',
  line: '#22323a',
  text: '#e8efed',
  muted: '#9fb3b0',
  accent: '#7fd1c9',
  teal: '#0b6e69',
  ok: '#1f8a4c',
  warn: '#b87d00',
  bad: '#b3261e',
  input: '#0c1316',
  inputLine: '#2c3f46',
};
export const toneColor = { ok: colors.ok, warn: colors.warn, bad: colors.bad } as const;
