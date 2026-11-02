/**
 * Alias de modeles (« deguisement ») : un nom de modele demande par le client
 * est converti en modele DeepSeek reel avant l'appel a l'API.
 *
 * Exemple par defaut : un client qui demande `claude-opus-5` (ou une variante
 * datee `claude-opus-5-20260101`) est servi par `deepseek-flash` (le modele
 * economique), et non par deepseek-v4-pro. Les noms `fable-5` et `fable-5.1`
 * sont egalement exposes et servis par `deepseek-flash`.
 *
 * Formats acceptes :
 * - correspondance exacte :  { "mon-modele": "deepseek-flash" }
 * - prefixe avec etoile  :  { "claude-opus-5*": "deepseek-flash" }
 *
 * Les quotas, le cout estime et les journaux utilisent toujours le modele
 * REELLEMENT facture par DeepSeek.
 */

export const DEFAULT_MODEL_ALIASES = Object.freeze({
  'claude-opus-5*': 'deepseek-flash',
  'fable-5': 'deepseek-flash',
  'fable-5.1': 'deepseek-flash',
});

/** Valide et normalise un objet d'alias. Lance une Error si invalide. */
export function normalizeModelAliases(input) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('les alias doivent etre un objet JSON { "nom demande": "modele DeepSeek" }');
  }
  const out = {};
  for (const [from, to] of Object.entries(input)) {
    const key = String(from ?? '').trim();
    const target = String(to ?? '').trim();
    if (!key) continue;
    if (key.length > 120) throw new Error(`alias trop long : ${key.slice(0, 40)}...`);
    if (!target) throw new Error(`alias "${key}" : modele cible manquant`);
    if (target.length > 120) throw new Error(`alias "${key}" : modele cible trop long`);
    out[key] = target;
  }
  return out;
}

/** Retourne le modele reel correspondant a un nom demande (ou le nom inchange). */
export function resolveModelAlias(model, aliases) {
  if (typeof model !== 'string' || !model) return model;
  const map = aliases && typeof aliases === 'object' ? aliases : {};

  if (Object.prototype.hasOwnProperty.call(map, model)) return map[model];

  // Motifs prefixes termines par « * », le plus long gagne.
  let best = null;
  for (const [pattern, target] of Object.entries(map)) {
    if (!pattern.endsWith('*')) continue;
    const prefix = pattern.slice(0, -1);
    if (!prefix || !model.startsWith(prefix)) continue;
    if (!best || prefix.length > best.prefix.length) best = { prefix, target };
  }
  return best ? best.target : model;
}

/**
 * Charge les alias effectifs depuis les reglages.
 * - aucun reglage  -> alias par defaut ;
 * - objet vide     -> aucun alias (fonctionnalite desactivee) ;
 * - JSON invalide  -> retour aux alias par defaut.
 */
export function loadModelAliases(getSetting) {
  let stored;
  try {
    stored = getSetting();
  } catch {
    return { ...DEFAULT_MODEL_ALIASES };
  }
  if (stored == null) return { ...DEFAULT_MODEL_ALIASES };
  try {
    return normalizeModelAliases(stored);
  } catch {
    return { ...DEFAULT_MODEL_ALIASES };
  }
}
