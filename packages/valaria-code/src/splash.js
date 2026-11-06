/**
 * Splash de démarrage animé, rendu directement en ANSI.
 * Se désactive avec VALARIA_NO_ANIMATION, --no-anim ou hors TTY.
 */
import { COLORS, bold, dim, paint } from './theme.js';
import { LOGO_LINES, SPLASH_PALETTE, TAGLINE } from './assets.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function playSplash({ output = process.stdout, color = true, reduced = false, frameMs = 220, version = '0.7.0' } = {}) {
  if (reduced || !output.isTTY || process.env.VALARIA_NO_ANIMATION || process.env.TERM === 'dumb') return;
  const cols = Math.max(54, Math.min(Number(output.columns) || 96, 220));
  const rows = Math.max(16, Number(output.rows) || 28);
  const logoWidth = Math.max(...LOGO_LINES.map((line) => line.length));
  const left = Math.max(0, Math.floor((cols - logoWidth) / 2));
  const top = Math.max(2, Math.floor((rows - 12) / 2));
  const frameCount = 6;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const lines = [];
    for (let index = 0; index < top; index += 1) lines.push('');
    const visible = Math.min(LOGO_LINES.length, 2 + frame * 2);
    for (let index = 0; index < LOGO_LINES.length; index += 1) {
      if (index >= visible) {
        lines.push('');
        continue;
      }
      const raw = LOGO_LINES[index];
      let art = '';
      for (let column = 0; column < raw.length; column += 1) {
        const char = raw[column];
        const tone = SPLASH_PALETTE[(column + frame * 2) % SPLASH_PALETTE.length];
        art += char === ' ' ? ' ' : paint(char, tone, color);
      }
      const offset = Math.max(0, left + Math.floor((logoWidth - raw.length) / 2));
      lines.push(`${' '.repeat(offset)}${art}`);
    }
    lines.push('');
    const scanWidth = Math.min(46, Math.max(18, cols - 10));
    const revealed = Math.max(1, Math.ceil((scanWidth * (frame + 1)) / frameCount));
    const scanLeft = Math.floor((cols - scanWidth) / 2);
    lines.push(`${' '.repeat(scanLeft)}${paint('─'.repeat(revealed), COLORS.accent, color)}`);
    lines.push('');
    lines.push(`${' '.repeat(Math.max(0, Math.floor((cols - TAGLINE.length) / 2)))}${dim(TAGLINE, color)}`);
    lines.push(`${' '.repeat(Math.max(0, Math.floor((cols - 14) / 2)))}${bold(`v${version}`, color)}`);
    output.write(`\x1b[H\x1b[2J${lines.join('\n')}\x1b[?25l`);
    await sleep(frameMs);
  }
  await sleep(400);
}


