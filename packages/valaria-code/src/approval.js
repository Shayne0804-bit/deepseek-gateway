/**
 * Politique d'approbation de l'agent.
 * strict : chaque écriture/commande doit être approuvée.
 * safe   : seules les actions sensibles ou dangereuses sont soumises.
 * full   : aucune approbation.
 */
export const APPROVAL_MODES = ['strict', 'safe', 'full'];

export const APPROVAL_LABELS = {
  strict: 'Strict',
  safe: 'Sécurisé',
  full: 'Accès total',
};

const DANGEROUS_COMMAND = /(^|[\s;&|])(rm\s+-(?:[a-z]*[rf][a-z]*)\b|rm\s+-rf\b|del\s+\/[a-z]\b|format\b|shutdown\b|reboot\b|git\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+--force)|npm\s+publish|pnpm\s+publish|yarn\s+publish|docker\s+(?:rm|prune|system\s+prune)|chmod\s+-R\b|chown\s+-R\b|sudo\b|curl[^|]*\|\s*(?:sh|bash)|wget[^|]*\|\s*(?:sh|bash)|>\s*\/dev\/sd[a-z]|mkfs\b)/i;

const SENSITIVE_PATH = /(^|[\\/])(?:\.env(?:\.[^\\/]+)?|\.git(?:[\\/]|$)|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|.*\.(?:pem|key|p12|pfx)|\.github(?:[\\/]|$)|Dockerfile|docker-compose\.ya?ml)/i;

export function isDangerousCommand(command) {
  return DANGEROUS_COMMAND.test(String(command || ''));
}

export function isSensitivePath(file) {
  return SENSITIVE_PATH.test(String(file || '').replace(/\\/g, '/'));
}

export function approvalRequired(mode, request) {
  if (mode === 'full') return false;
  if (!request) return true;
  if (mode === 'strict') return true;
  if (request.type === 'write') return isSensitivePath(request.file);
  if (request.type === 'run') return isDangerousCommand(request.command);
  return true;
}
