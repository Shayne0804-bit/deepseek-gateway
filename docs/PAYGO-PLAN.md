# VALARIA Gateway — plan PAYG et durcissement restant

État au 2026-11-06 : production `v3.9.1`, crédit site 3,75×, pass 7/14/30 j,
plafonds glissants 5 h et semaine, réservations de crédit persistantes en
micro-USD, 2FA admin optionnelle.

## 1. Ledger micro-USD complet

Objectif : ne plus jamais stocker un montant monétaire en flottant.

### Schéma cible

- `clients.quota_micro_usd` (INTEGER / Long)
- `clients.used_micro_usd` (INTEGER / Long)
- `usage_logs.real_cost_micro_usd` (coût réel interne)
- `usage_logs.site_cost_micro_usd` (crédit site débité)
- `wallet_ledger` : `id`, `client_id`, `type` (`topup`, `usage`, `refund`,
  `adjustment`, `reservation`), `amount_micro_usd`, `reference`, `created_at`.
- `credit_reservations` : déjà en micro-USD.

### Migration

1. Ajouter les colonnes sans supprimer les anciennes.
2. Backfill : `micro = ROUND(usd * 1e6)`.
3. Marqueur `money_schema = micro_v1` en settings.
4. Double écriture temporaire (USD legacy + micro) pendant une release.
5. Bascule des lectures sur micro ; suppression des colonnes USD ensuite.
6. Tests : migration rejouable, valeurs négatives impossibles, arrondi exact.

### Règles

- Tous les calculs internes en entiers micro-USD.
- Les API renvoient des dollars formatés à 6 décimales (`micro / 1e6`).
- Aucune comparaison de solde en flottant.
- Toute écriture de solde passe par le ledger, jamais par un `UPDATE` direct.

## 2. Wallet PAYG (à faire quand le paiement sera choisi)

### Modèle

- `wallets` : `client_id`, `balance_micro_usd`, `currency`.
- `wallet_ledger` : source de vérité, append-only.
- `payment_transactions` : fournisseur, référence, montant, devise, statut,
  pack, idempotency key.
- Un pass actif est consommé avant le wallet ; sinon le wallet prend le relais.

### Packs / montants

- Montants prédéfinis + montant personnalisé (déjà en aperçu).
- Minimum 1 000 FCFA, pas de 500 FCFA.
- Prix par dollar de crédit : 526–556 FCFA selon le montant.
- Pas d'expiration (ou 12 mois, décision commerciale).
- Pas de plafond 5 h/semaine en PAYG : le solde prépayé est la limite.
- RPM/concurrence conservés.

### Flux paiement

1. Création d'une intention de paiement côté serveur (montant jamais fourni
   par le client).
2. Redirection vers CinetPay/Kkiapay/PayDunya/Stripe.
3. Retour navigateur = simple information, aucun crédit.
4. Webhook signé + vérification montant/devise/référence.
5. Écriture ledger idempotente (contrainte unique sur référence fournisseur).
6. Reçu et notification.
7. Rapprochement quotidien ; remboursement = écriture négative au ledger.

### Sécurité paiement

- Secret webhook en variable d'environnement.
- Vérification HMAC et horodatage/replay.
- Idempotency key unique en base.
- Aucun crédit sur la seule redirection de retour.
- Rate limit top-up par IP/client.
- Journal d'audit de chaque mouvement.
- Test de rejeu, montant modifié et signature invalide.

## 3. Énumération de comptes

Le produit affiche aujourd'hui explicitement `account_exists` et
`account_not_found`. Pour fermer ce canal :

1. Réponses HTTP strictement identiques pour inscription/connexion email.
2. Envoyer un code dans les deux cas :
   - compte existant → code de connexion ;
   - email inconnu → code d'inscription (si inscription activée).
3. À la vérification :
   - compte existant → session de connexion ;
   - email inconnu → création du pass d'essai.
4. Même message générique : « Si cette adresse peut être utilisée, un code a
   été envoyé. Vérifiez votre email. »
5. Conserver les erreurs purement techniques (email jetable, captcha, rate
   limit) qui ne révèlent pas l'existence du compte.
6. Tests : le corps et le statut HTTP ne doivent pas différer entre les deux
   cas, hors délai réseau.

Impact UX : le message « compte déjà existant » disparaît ; le parcours reste
fonctionnel car un code est envoyé dans les deux cas.

## 4. Rotation du secret hCaptcha

Le secret a été exposé dans une conversation ; il doit être considéré comme
compromis.

1. hCaptcha → site → Settings → Secret Key → Regenerate.
2. Railway → `HCAPTCHA_SECRET_KEY=<nouveau>`.
3. Redéployer.
4. Vérifier `/portal/api/config` (`captchaProvider=hcaptcha`,
   `captchaRequired=true`) et une demande de code sans token → 403.
5. Ne jamais coller le secret dans un chat, un fichier ou Git.

## Ordre recommandé

1. Ledger micro-USD complet (bloquant pour tout paiement réel).
2. Réponses email génériques (énumération).
3. Rotation du secret hCaptcha (action opérateur).
4. Wallet PAYG quand le fournisseur de paiement est choisi.

Le mode PAYG reste en `Release soon` jusque-là : aucun endpoint de paiement,
aucun crédit créé, aucun webhook actif.

## Mise a jour du 2026-11-06

- Point 3 (enumeration) : implemente (reponses generiques + code envoye dans les deux cas + creation/connexion a la verification).
- Point 1 : reservations et conversions micro-USD en place ; migration complete des colonnes historiques encore a faire.
- Point 4 : rotation hCaptcha a executer cote operateur.

