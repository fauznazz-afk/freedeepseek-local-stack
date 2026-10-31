'use strict';

// Upstream failure classification.
//
// Detecting a rate limit used to mean testing localized strings in half a dozen
// places. That breaks silently the day DeepSeek changes its wording. One table
// now answers two questions for every upstream failure: what kind is it, and can
// the same request succeed by moving to another login?
//
// Patterns stay here. Callers read the classification, not the text.

// "rate limit" must not start inside a word ("generate limit", "moderate limit").
const RATE_LIMIT_PATTERN = /(?<![a-z])rate[\s_-]*limit|too\s+many\s+requests|too\s+frequent|слишком\s+част|частые\s+(?:сообщения|запросы)|频繁|请求过多|请求次数过多/i;

const CONTEXT_TOO_LONG_PATTERN = /(?:content|prompt|context).{0,40}(?:too\s+long|too\s+large|length|limit|maximum)|maximum.{0,30}(?:context|token)|too\s+many\s+tokens|содержани[ея]\s+слишком\s+длин|контекст.{0,30}(?:длин|лимит)|内容.{0,12}(?:过长|太长)|上下文.{0,12}(?:过长|超出)/i;

const AUTH_PATTERN = /authorization failed|invalid token|4000[123]/i;
// A WAF/PoW 401 is transient and must not count toward the quarantine ladder.
const TRANSIENT_AUTH_PATTERN = /pow|challenge|waf/i;

// Flatten every shape DeepSeek uses into one searchable string: a bare string,
// an error object, a stream fragment, or a parsed JSON body.
function signalText(signal) {
    if (!signal) return '';
    if (typeof signal === 'string') return signal;
    if (typeof signal !== 'object') return String(signal);
    return [signal.content, signal.message, signal.msg, signal.biz_msg, signal.finish_reason, signal.type, signal.detail]
        .filter(value => typeof value === 'string' && value)
        .join(' ');
}

function isRateLimitSignal(signal) {
    if (!signal) return false;
    if (typeof signal === 'object' && /rate_?limit/i.test(String(signal.finish_reason || ''))) return true;
    const text = signalText(signal);
    return Boolean(text) && RATE_LIMIT_PATTERN.test(text);
}

function isContextTooLongSignal(signal) {
    // A throttled login is not an oversized prompt: never compact for it.
    if (isRateLimitSignal(signal)) return false;
    const text = signalText(signal);
    return Boolean(text) && CONTEXT_TOO_LONG_PATTERN.test(text);
}

function isAuthSignal(signal) {
    return AUTH_PATTERN.test(signalText(signal));
}

function isTransientAuthSignal(signal) {
    return TRANSIENT_AUTH_PATTERN.test(signalText(signal));
}

/**
 * Classify one upstream failure.
 *
 * @param {{status?: number, body?: string, signal?: any, timedOut?: boolean, overflow?: boolean}} input
 * @returns {{kind: 'rate_limit'|'auth'|'auth_transient'|'overflow'|'timeout'|'upstream',
 *            status: number, type: string, retryable: boolean, failover: boolean,
 *            cooldownMs: number|null, detail: string}}
 */
function classifyUpstreamFailure(input = {}) {
    const status = Number(input.status) || 0;
    const detail = String(input.body || '').replace(/\s+/g, ' ').trim().substring(0, 300);
    const signal = input.signal !== undefined ? input.signal : input.body;

    if (input.overflow || isContextTooLongSignal(signal)) {
        return { kind: 'overflow', status: 400, type: 'context_length_exceeded', retryable: true, failover: false, cooldownMs: null, detail };
    }
    if (status === 429 || isRateLimitSignal(signal)) {
        return { kind: 'rate_limit', status: 429, type: 'rate_limit_error', retryable: true, failover: true, cooldownMs: null, detail };
    }
    if (input.timedOut) {
        return { kind: 'timeout', status: 504, type: 'request_timeout', retryable: false, failover: false, cooldownMs: null, detail };
    }
    if (status === 401 || status === 403) {
        const transient = isTransientAuthSignal(signal);
        return {
            kind: transient ? 'auth_transient' : 'auth',
            status: 401,
            type: 'authentication_error',
            // A dead credential is worth retrying on another login; a PoW/WAF
            // challenge is not a credential problem at all.
            retryable: transient,
            failover: !transient,
            cooldownMs: null,
            detail,
        };
    }
    const code = status || 502;
    return { kind: 'upstream', status: code, type: 'upstream_http_error', retryable: false, failover: false, cooldownMs: null, detail };
}

module.exports = {
    RATE_LIMIT_PATTERN,
    signalText,
    isRateLimitSignal,
    isContextTooLongSignal,
    isAuthSignal,
    isTransientAuthSignal,
    classifyUpstreamFailure,
};
