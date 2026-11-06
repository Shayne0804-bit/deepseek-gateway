/**
 * Premier choix après connexion : univers Claude ou Codex, puis modèle.
 * Interface ANSI dédiée (pas de prompt shell générique).
 */
import { COLORS, bold, dim, paint, supportsColor } from './theme.js';

export const MODEL_FAMILIES = [
  { id: 'claude', label: 'Claude', description: 'Raisonnement, rédaction et code' },
  { id: 'codex', label: 'Codex', description: 'Code, agents et refactorisation' },
];

export function groupModels(models = []) {
  const claude = models.filter((name) => /^claude/i.test(name));
  const codex = models.filter((name) => /^(gpt-5|gpt-4|codex)/i.test(name));
  return {
    claude: claude.length ? claude : models,
    codex: codex.length ? codex : models,
  };
}

function writeScreen(lines) {
  process.stdout.write(`\x1b[H\x1b[2J${lines.join('\n')}`);
}

/**
 * Retourne le modèle choisi, ou null si annulé / non interactif.
 */
export async function chooseModel({ models = [], color = supportsColor(), input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY || process.env.VALARIA_NO_ONBOARDING) return null;
  const c = (text, hex) => paint(text, hex, color);
  const b = (text) => bold(text, color);
  const d = (text) => dim(text, color);
  const families = groupModels(models);
  const cols = Math.max(58, Math.min(Number(output.columns) || 92, 110));
  let screen = 'family';
  let familyIndex = 0;
  let modelIndex = 0;
  let choice = null;

  const render = () => {
    const lines = [];
    lines.push(`  ${c('V', COLORS.accent)}  ${b('VALARIA CODE')}   ${d('configuration du compte')}`);
    lines.push(`  ${d('─'.repeat(cols - 4))}`);
    lines.push('');
    if (screen === 'family') {
      lines.push(`  ${d('Quel univers voulez-vous utiliser ?')}`);
      lines.push('');
      MODEL_FAMILIES.forEach((family, index) => {
        const selected = index === familyIndex;
        const marker = selected ? c('›', COLORS.accent) : ' ';
        const label = selected ? c(family.label, COLORS.accent) : family.label;
        const available = families[family.id]?.length || 0;
        lines.push(`  ${marker} ${pad(label, 12)} ${d(`${available} modèle(s) · ${family.description}`)}`);
      });
    } else {
      const family = MODEL_FAMILIES[familyIndex];
      const available = families[family.id] || [];
      lines.push(`  ${d('Univers')} ${c(family.label, COLORS.accent)}  ${d('· choisissez le modèle')}`);
      lines.push('');
      available.forEach((name, index) => {
        const selected = index === modelIndex;
        const marker = selected ? c('›', COLORS.accent) : ' ';
        lines.push(`  ${marker} ${selected ? c(name, COLORS.text) : name}`);
      });
      lines.push('');
      lines.push(`  ${d('Ce choix sera enregistré sur cet appareil ; /model permet de changer ensuite.')}`);
    }
    lines.push('');
    lines.push(`  ${d('↑↓ choisir · Entrée valider · Échap annuler')}`);
    writeScreen(lines);
  };

  return new Promise((resolve) => {
    let finished = false;
    const cleanup = (value) => {
      if (finished) return;
      finished = true;
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      output.write('\x1b[?25h\x1b[?1049l');
      resolve(value);
    };
    const onData = (key) => {
      if (key === '\u0003' || key === '\u001b') {
        if (screen === 'model') { screen = 'family'; render(); return; }
        cleanup(null);
        return;
      }
      if (key === '\x1b[A' || key === 'k') {
        if (screen === 'family') familyIndex = (familyIndex + MODEL_FAMILIES.length - 1) % MODEL_FAMILIES.length;
        else {
          const list = families[MODEL_FAMILIES[familyIndex].id] || [];
          modelIndex = (modelIndex + list.length - 1) % Math.max(1, list.length);
        }
        render();
        return;
      }
      if (key === '\x1b[B' || key === 'j') {
        if (screen === 'family') familyIndex = (familyIndex + 1) % MODEL_FAMILIES.length;
        else {
          const list = families[MODEL_FAMILIES[familyIndex].id] || [];
          modelIndex = (modelIndex + 1) % Math.max(1, list.length);
        }
        render();
        return;
      }
      if (key === '\r' || key === '\n') {
        if (screen === 'family') {
          const list = families[MODEL_FAMILIES[familyIndex].id] || [];
          if (!list.length) return;
          modelIndex = 0;
          screen = 'model';
          render();
          return;
        }
        choice = (families[MODEL_FAMILIES[familyIndex].id] || [])[modelIndex] || null;
        cleanup(choice);
      }
    };
    output.write('\x1b[?1049h\x1b[?25l');
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
    render();
  });
}

function pad(text, width) {
  return `${text}${' '.repeat(Math.max(0, width - String(text).length))}`;
}
