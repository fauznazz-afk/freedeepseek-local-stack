'use strict';
/**
 * Persist per-account cooldowns across restarts.
 *
 * A cooldown is a *remote* fact: DeepSeek throttled this login and will keep
 * throttling it for roughly the same window no matter how many times the local
 * process restarts. Keeping it in memory only meant `deepseek-local restart`
 * appeared to fix the throttle, the next request hit DeepSeek again, and the
 * cooldown was re-armed from scratch - so a restart could actually make things
 * worse instead of better.
 *
 * The store is keyed by account id and by a fingerprint of the credentials, so a
 * re-login (new token or cookie) starts clean: a fresh login is a different
 * upstream identity and is not throttled by the old window.
 *
 * It deliberately holds no secrets - only ids, timestamps and a hash.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // ignore anything older than a day
const SAVE_DEBOUNCE_MS = 500;

function credentialsFingerprint(config = {}) {
    const token = String(config.token || '');
    const cookie = String(config.cookie || '');
    if (!token && !cookie) return '';
    return crypto.createHash('sha256').update(`${token}\u0000${cookie}`).digest('hex').slice(0, 32);
}

function createCooldownStore(filePath, { now = Date.now, log = console } = {}) {
    let entries = {};
    let timer = null;

    function load() {
        try {
            if (!fs.existsSync(filePath)) return {};
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            const cutoff = now() - MAX_AGE_MS;
            const kept = {};
            for (const [id, entry] of Object.entries(parsed)) {
                if (!entry || typeof entry !== 'object') continue;
                const until = Number(entry.cooldownUntil);
                if (!Number.isFinite(until) || until <= cutoff) continue;
                kept[id] = {
                    cooldownUntil: until,
                    cooldownReason: typeof entry.cooldownReason === 'string' ? entry.cooldownReason : null,
                    fingerprint: typeof entry.fingerprint === 'string' ? entry.fingerprint : '',
                };
            }
            return kept;
        } catch (e) {
            // A corrupt state file must never block startup: cooldowns are an
            // optimisation, not a source of truth.
            log.error?.(`[DS-API] Could not read cooldown state: ${e.message}`);
            return {};
        }
    }

    // Load eagerly. `apply` is called from applyAccountsList during startup, and a
    // store that only loaded on an explicit _load() call silently restored nothing.
    entries = load();

    function flush() {
        timer = null;
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const json = JSON.stringify(entries, null, 2);
            const tmp = `${filePath}.tmp`;
            fs.writeFileSync(tmp, json, { mode: 0o600 });
            fs.renameSync(tmp, filePath);
        } catch (e) {
            log.error?.(`[DS-API] Could not save cooldown state: ${e.message}`);
        }
    }

    function schedule() {
        if (timer) return;
        timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
        if (typeof timer.unref === 'function') timer.unref();
    }

    return {
        /** Restore a saved cooldown onto a live account, if it still applies. */
        apply(account) {
            if (!account || !account.id) return false;
            const entry = entries[account.id];
            if (!entry) return false;
            const fingerprint = credentialsFingerprint(account.config);
            // A different login is a different upstream identity: do not inherit
            // the previous login's throttle.
            if (entry.fingerprint && fingerprint && entry.fingerprint !== fingerprint) return false;
            if (entry.cooldownUntil <= now()) return false;
            if ((account.cooldownUntil || 0) >= entry.cooldownUntil) return false;
            account.cooldownUntil = entry.cooldownUntil;
            account.cooldownReason = entry.cooldownReason;
            return true;
        },
        /** Record the account's current cooldown. Clears it when it has expired. */
        record(account) {
            if (!account || !account.id) return;
            const until = Number(account.cooldownUntil) || 0;
            if (until > now()) {
                entries[account.id] = {
                    cooldownUntil: until,
                    cooldownReason: account.cooldownReason || null,
                    fingerprint: credentialsFingerprint(account.config),
                };
            } else if (entries[account.id]) {
                delete entries[account.id];
            } else {
                return;
            }
            schedule();
        },
        /** Drop a saved entry outright, e.g. after a successful request. */
        clear(accountId) {
            if (!entries[accountId]) return;
            delete entries[accountId];
            schedule();
        },
        flush,
        _load: () => {
            entries = load();
            return { ...entries };
        },
        _entries: () => ({ ...entries }),
    };
}

module.exports = { createCooldownStore, credentialsFingerprint };
