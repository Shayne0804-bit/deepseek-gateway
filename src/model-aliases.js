/**
 * Alias de modeles (« deguisement ») : un nom de modele demande par le client
 * est converti en modele DeepSeek reel avant l'appel a l'API.
 *
 * Exemple par defaut : un client qui demande `claude-opus-5` (ou une variante
 * datee `claude-opus-5-20260101`) est servi par `deepseek-flash` (le modele
 * economique), et non par deepseek-v4-pro. Les noms `claude-opus-5.5`, `fable-5`
 * et `fable-5.1` sont egalement exposes et servis par `deepseek-flash`.
 *
 * Formats acceptes :
 * - correspondance exacte :  { "mon-modele": "deepseek-flash" }
 * - prefixe avec etoile  :  { "claude-opus-5*": "deepseek-flash" }
 *
 * Tous les alias exposent la meme capacite reelle : generation de texte et de
 * code via le modele economique. Un alias d'image, d'audio ou de video est
 * refuse : la passerelle ne charge pas ces modeles.
 *
 * Les quotas, le cout estime et les journaux utilisent toujours le modele
 * REELLEMENT facture par DeepSeek.
 */

// Noms de modeles ou de fonctions qui ne correspondent pas a la capacite
// texte/code servie par la passerelle. Ils ne doivent jamais etre acceptes.
const NON_TEXT_MODEL_ALIAS_PATTERN = /(dall[\s._-]?e|gpt-image|image[\s._-]?gen|imagegen|imagen|flux|stable[\s._-]?diffusion|midjourney|text[\s._-]?to[\s._-]?image|sora|veo|text[\s._-]?to[\s._-]?video|whisper|tts|text[\s._-]?to[\s._-]?speech|audio|video)/i;
const RETIRED_MODEL_ALIAS_PATTERN = /^(codex|o3|o4-mini)(?:$|[\s._-])/i;

export function isTextCompatibleAlias(name) {
  return !NON_TEXT_MODEL_ALIAS_PATTERN.test(String(name ?? ''));
}

export function isRetiredModelAlias(name) {
  return RETIRED_MODEL_ALIAS_PATTERN.test(String(name ?? ''));
}

/**
 * Liste publique des modeles : masque les identifiants internes `alias:*`
 * et supprime les doublons (comparaison insensible a la casse).
 */
export function publicModelIds(input) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const id = String(raw ?? '').trim();
    if (!id || /^alias:/i.test(id)) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

export const DEFAULT_MODEL_ALIASES = Object.freeze({
  'claude-opus-5*': 'deepseek-flash',
  'claude-opus-5.5': 'deepseek-flash',
  'fable-5': 'deepseek-flash',
  'fable-5.1': 'deepseek-flash',
  // Alias OpenAI / Codex : les clients OpenAI et Codex CLI envoient leurs
  // propres noms de modeles. Ils sont acceptes et servis par le modele
  // economique, sans exposer le modele reel dans le guide.
  'gpt-5-codex*': 'deepseek-flash',
  'gpt-5.1-codex*': 'deepseek-flash',
  'gpt-5*': 'deepseek-flash',
  // Le nom v4-pro reste expose commercialement, mais il est reellement servi par flash.
  'deepseek-v4-pro': 'deepseek-flash',
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
    if (!isTextCompatibleAlias(key)) {
      throw new Error(`modele "${key}" refuse : la passerelle sert uniquement un modele texte/code, pas un modele d'image, d'audio ou de video`);
    }
    if (isRetiredModelAlias(key)) {
      throw new Error(`modele "${key}" non disponible sur cette passerelle`);
    }
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
