/**
 * Argent : la source de verite est le micro-USD entier (1 USD = 1 000 000).
 * Les valeurs en dollars flottants ne doivent servir qu'a l'affichage.
 */
export const MICRO_USD = 1_000_000;

export function toMicroUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * MICRO_USD);
}

export function fromMicroUsd(micro) {
  const number = Number(micro);
  if (!Number.isFinite(number)) return 0;
  return number / MICRO_USD;
}

export function formatMicroUsd(micro) {
  return fromMicroUsd(micro).toFixed(6);
}
