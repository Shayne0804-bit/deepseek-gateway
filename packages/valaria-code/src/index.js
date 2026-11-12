/** SDK public VALARIA Code. */
export { ValariaClient, ApiError, createClient } from './api.js';
export { loginWithDevice, AuthError, tokenIsExpired } from './auth.js';
export {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  clearConfig,
  configFile,
  homeDir,
  loadConfig,
  normalizeBaseUrl,
  resolveAuthConfig,
  saveConfig,
} from './config.js';
export { runTui } from './tui.js';
export { runAgent } from './agent.js';
export {
  SESSION_VERSION,
  MAX_SESSION_MESSAGES,
  MAX_CONTEXT_MESSAGES,
  appendSessionTurn,
  clearSession,
  createSession,
  loadSession,
  saveSession,
  sessionApiMessages,
  sessionFile,
  sessionSummary,
} from './session.js';
export { APPROVAL_LABELS, APPROVAL_MODES, approvalRequired, isDangerousCommand, isSensitivePath } from './approval.js';
export { chooseModel } from './onboarding.js';
export { playSplash } from './splash.js';
export { LOGO_LINES, MARK, TAGLINE, WORDMARK } from './assets.js';
export { diffText, extractCode, listFiles, readFile, runCommand, writeFile } from './tools.js';
