/**
 * Garde-fous anti-abus et anti-surcharge, en memoire (mono-instance).
 * - IpRateLimiter : fenetre glissante de requetes par IP.
 * - Semaphore     : plafond global de requetes simultanees.
 */

export class IpRateLimiter {
  constructor(nowFn = Date.now) {
    this.now = nowFn;
    this.map = new Map();
  }

  /** Retourne { ok, retryAfter } pour une IP et une limite par minute. */
  hit(key, limitPerMinute) {
    if (!limitPerMinute || limitPerMinute <= 0) return { ok: true, retryAfter: 0 };
    const now = this.now();
    const windowStart = now - 60_000;
    const list = (this.map.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    if (list.length >= limitPerMinute) {
      this.map.set(key, list);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0] + 60_000 - now) / 1000)) };
    }
    list.push(now);
    this.map.set(key, list);
    return { ok: true, retryAfter: 0 };
  }

  prune() {
    const windowStart = this.now() - 60_000;
    for (const [key, list] of this.map) {
      const kept = list.filter((timestamp) => timestamp > windowStart);
      if (kept.length) this.map.set(key, kept);
      else this.map.delete(key);
    }
  }
}

export class Semaphore {
  constructor(limit = 0) {
    this.limit = Number.isFinite(limit) && limit > 0 ? limit : 0;
    this.active = 0;
  }

  /** 0 = illimite. */
  tryAcquire() {
    if (this.limit === 0) {
      this.active += 1;
      return true;
    }
    if (this.active >= this.limit) return false;
    this.active += 1;
    return true;
  }

  release() {
    if (this.active > 0) this.active -= 1;
  }
}

/**
 * Reservations de credit en cours de requete.
 * Empeche deux requetes concurrentes de passer le meme plafond avant que
 * l'usage reel soit enregistre. Portee processus : suffisant en mono-instance.
 */
export class CreditReservationBook {
  constructor() {
    this.held = new Map();
  }

  heldFor(clientId) {
    return this.held.get(clientId) ?? 0;
  }

  tryReserve(clientId, amount, remaining) {
    const value = Math.max(0, Number(amount) || 0);
    if (value === 0) return true;
    const currentlyHeld = this.heldFor(clientId);
    if (currentlyHeld + value > Math.max(0, Number(remaining) || 0) + 1e-9) return false;
    this.held.set(clientId, currentlyHeld + value);
    return true;
  }

  release(clientId, amount) {
    const value = Math.max(0, Number(amount) || 0);
    const next = this.heldFor(clientId) - value;
    if (next > 1e-9) this.held.set(clientId, next);
    else this.held.delete(clientId);
  }
}
