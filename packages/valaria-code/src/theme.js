/**
 * Identité terminal VALARIA Code — direction « Signal Ledger ».
 * Couleurs et primitives d'affichage, sans dépendance npm.
 */
export const COLORS = {
  bg: '#0a0e0c',
  panel: '#0d1310',
  text: '#e8f3ec',
  muted: '#8ca698',
  dim: '#5d8769',
  accent: '#7fe3aa',
  accent2: '#48bd82',
  amber: '#f0c674',
  danger: '#ff6f61',
  border: '#1d3b28',
};

export function supportsColor(stream = process.stdout) {
  return Boolean(stream.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
}

function rgb(hex) {
  const value = hex.replace('#', '');
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export function paint(text, hex, color = true) {
  if (!color) return String(text);
  const [r, g, b] = rgb(hex);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

export function bold(text, color = true) {
  return color ? `\x1b[1m${text}\x1b[0m` : String(text);
}

export function dim(text, color = true) {
  return color ? `\x1b[2m${text}\x1b[0m` : String(text);
}

export function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

export function visibleLength(text) {
  return stripAnsi(String(text)).length;
}

export function truncate(text, width) {
  const raw = String(text);
  if (width <= 0) return '';
  return visibleLength(raw) <= width ? raw : `${raw.slice(0, Math.max(0, width - 1))}…`;
}

export function wrap(text, width) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let rest = paragraph;
    while (rest.length > width) {
      let cut = rest.lastIndexOf(' ', width);
      if (cut < Math.floor(width * 0.55)) cut = width;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    lines.push(rest);
  }
  return lines;
}

export function rule(width, color = true) {
  return paint('─'.repeat(Math.max(0, width)), COLORS.border, color);
}
