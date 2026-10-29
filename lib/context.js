'use strict';

// Structured context compaction.
//
// The proxy talks to DeepSeek's web chat, which has a hard character budget.
// When a coding session outgrows it, something has to give. Slicing the prompt
// head-and-tail is the cheapest thing to do and the most expensive in trust:
// the model receives a transcript with a silent hole in the middle, and it
// fills that hole with invention - invented file contents, invented test
// results, invented "you said earlier".
//
// So this module condenses instead of amputating, and - more importantly - says
// what it did. Every compacted prompt carries a notice naming what was
// shortened and forbidding the model from claiming to remember what it cannot
// see. A model that knows it lost context asks a question; a model that does
// not know, guesses.

const TURN_SPLIT = /(?=^User: |^Assistant: |^\[Tool Result\])/m;
const CONDENSE_MARKER = '\n[... shortened ...]\n';
const OMITTED_MARKER = '\n[earlier turns omitted]\n';

// Pinned to every compacted prompt. This is the actual anti-confabulation lever:
// the failure mode is not "the model forgot", it is "the model did not notice it
// had forgotten" and covered the gap with plausible detail.
const COMPACTION_NOTICE = [
    '[Context notice: this conversation was condensed to fit the model context window.]',
    'What follows is: the original task, a condensed record of the middle turns, and the most recent turns verbatim.',
    'Anything marked "[... shortened ...]" or "[earlier turns omitted]" was cut down, not deleted from the project.',
    'While this notice is present:',
    '- Do not claim to remember details that are not shown above.',
    '- Do not invent file contents, paths, command output, test results, error messages, or earlier statements.',
    '- If a detail you need is missing, say so plainly and re-read the source with a tool instead of guessing.',
].join('\n');

// Anchors are the parts of a turn that stay useful even when the prose around
// them is gone: what file, what command, what error, what link. Extracting them
// is what makes a condensed tool result still actionable instead of a stub.
const ANCHOR_PATTERNS = [
    /[A-Za-z]:\\[^\s"'<>|,;)]+/g,                       // C:\path\to\file.js
    /https?:\/\/[^\s"'<>)]+/g,                          // URLs
    /(?:^|[\s("'`])(\/(?:[\w.@-]+\/)*[\w.@-]+\.\w{1,8})/g, // /src/app.js
    /\b(?:npm|pnpm|yarn|bun|git|node|python|pip|docker|kubectl|cargo|go|dotnet|java|mvn|gradle)\s+[^\n"'`]{2,90}/g,
];

const ERROR_ANCHOR = /^.*\b(?:error|failed|failure|exception|traceback|undefined is not|cannot find|not found|denied|timeout)\b.*$/gim;

function splitTurns(text) {
    const value = String(text || '');
    if (!value) return [];
    return value.split(TURN_SPLIT).filter(Boolean);
}

function turnKind(turn) {
    if (/^\[Tool Result\]/.test(turn)) return 'tool';
    if (/^Assistant: /.test(turn)) return 'assistant';
    if (/^User: /.test(turn)) return 'user';
    return 'other';
}

/**
 * Distinct, order-preserving anchors from a turn, capped so a pathological file
 * dump cannot flood the budget with matches.
 */
function extractAnchors(text, limit = 40) {
    const value = String(text || '');
    const seen = new Set();
    const out = [];
    const push = (candidate) => {
        const anchor = String(candidate || '').trim();
        if (!anchor || anchor.length < 3) return;
        if (seen.has(anchor)) return;
        seen.add(anchor);
        out.push(anchor);
    };

    for (const pattern of ANCHOR_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(value)) !== null) {
            push(match[1] || match[0]);
            if (out.length >= limit) return out;
        }
    }
    ERROR_ANCHOR.lastIndex = 0;
    let errorMatch;
    while ((errorMatch = ERROR_ANCHOR.exec(value)) !== null) {
        push(errorMatch[0].trim().slice(0, 160));
        if (out.length >= limit) return out;
    }
    return out;
}

/** Head-and-tail cut with an explicit marker, never a silent truncation. */
function truncateMiddle(text, maxChars, headRatio = 0.4) {
    const value = String(text || '');
    const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
    if (value.length <= limit) return value;
    if (limit <= CONDENSE_MARKER.length) return value.slice(value.length - limit);
    const payload = limit - CONDENSE_MARKER.length;
    const head = Math.max(0, Math.min(payload, Math.floor(payload * headRatio)));
    const tail = payload - head;
    return value.slice(0, head) + CONDENSE_MARKER + value.slice(value.length - tail);
}

/**
 * Shrink one turn to `cap` characters while keeping its identity: the opening
 * line (what this turn was about), its anchors (paths, commands, errors), and
 * its tail (where it ended up).
 */
function condenseTurn(turn, cap) {
    const value = String(turn || '');
    const limit = Math.max(0, Math.floor(Number(cap) || 0));
    if (value.length <= limit) return value;
    if (limit <= 120) return truncateMiddle(value, limit, 0.5);

    const anchors = extractAnchors(value, 24);
    const headBudget = Math.floor(limit * 0.40);
    const tailBudget = Math.floor(limit * 0.30);
    const anchorBudget = Math.max(0, limit - headBudget - tailBudget - 40);

    const head = value.slice(0, headBudget);
    const tail = value.slice(value.length - tailBudget);
    let anchorBlock = '';
    if (anchors.length && anchorBudget > 60) {
        const lines = anchors.join('\n');
        anchorBlock = `\n[key details]\n${lines.slice(0, anchorBudget)}\n`;
    }
    const composed = head + CONDENSE_MARKER + anchorBlock + tail;
    // The anchor block is best-effort; if it overshoots, fall back to a plain cut.
    return composed.length <= limit ? composed : truncateMiddle(value, limit, 0.45);
}

function omissionLine(count) {
    if (count <= 0) return '';
    return `\n[earlier turns omitted: ${count} turn${count === 1 ? '' : 's'} from the middle of this conversation were dropped to fit the context window. Re-read files with a tool if you need them.]\n`;
}

/**
 * Distribute a character budget across turns, giving short turns exactly what
 * they need and handing the surplus to the long ones (water-filling). An even
 * split wastes budget whenever one turn is huge and its neighbours are short -
 * and that wasted budget is exactly the context the model needed.
 */
function allocateBudget(lengths, budget) {
    const total = lengths.reduce((sum, n) => sum + n, 0);
    if (total <= budget) return lengths.slice();
    const caps = new Array(lengths.length).fill(0);
    let remaining = budget;
    let pending = lengths.map((len, index) => ({ len, index })).sort((a, b) => a.len - b.len);
    while (pending.length > 0) {
        const share = Math.floor(remaining / pending.length);
        const smallest = pending[0];
        if (smallest.len <= share) {
            caps[smallest.index] = smallest.len;
            remaining -= smallest.len;
            pending = pending.slice(1);
        } else {
            for (const item of pending) caps[item.index] = Math.max(1, share);
            remaining = 0;
            break;
        }
    }
    return caps;
}

/**
 * Compact a formatted conversation to `maxChars`.
 *
 * Strategy, in order: keep the opening task, keep the newest turns verbatim,
 * condense the middle (anchors intact), and only then drop middle turns -
 * leaving an explicit count of what was dropped. The result always carries
 * COMPACTION_NOTICE so the model knows the transcript is incomplete.
 *
 * @returns {{text: string, compacted: boolean, condensedTurns: number, droppedTurns: number, originalChars: number}}
 */
function structuredCompact(conversation, maxChars, options = {}) {
    const value = String(conversation || '');
    const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
    const alreadyNoticed = value.includes(COMPACTION_NOTICE);
    const notice = alreadyNoticed ? '' : COMPACTION_NOTICE;
    const reserve = notice ? notice.length + 4 : 0;

    const result = (text, extra = {}) => ({
        text,
        compacted: true,
        condensedTurns: 0,
        droppedTurns: 0,
        originalChars: value.length,
        ...extra,
    });

    if (!value) return { text: '', compacted: false, condensedTurns: 0, droppedTurns: 0, originalChars: 0 };
    if (value.length <= limit) return { text: value, compacted: false, condensedTurns: 0, droppedTurns: 0, originalChars: value.length };

    const bodyLimit = Math.max(200, limit - reserve);
    const withNotice = (body) => (notice ? `${body}\n\n${notice}` : body);

    const turns = splitTurns(value);
    if (turns.length <= 1) {
        // Nothing to prioritise: one blob. Cut it, but still say so.
        return result(withNotice(truncateMiddle(value, bodyLimit, 0.35)));
    }

    const keepRecent = Math.min(turns.length - 1, Math.max(2, Math.floor(turns.length * 0.35)));
    const head = turns.slice(0, 1);
    const middle = turns.slice(1, turns.length - keepRecent);
    const recent = turns.slice(turns.length - keepRecent);

    // The opening turn is the task; give it room, but not more than it needs.
    const headCap = Math.min(head[0].length, Math.max(400, Math.floor(bodyLimit * 0.3)));
    const headText = condenseTurn(head[0], headCap);

    // Recent turns are the working set: verbatim while they fit.
    let recentFinal = recent.join('');
    const recentBudget = Math.max(400, bodyLimit - headText.length);
    if (recentFinal.length > recentBudget) {
        const caps = allocateBudget(recent.map((turn) => turn.length), recentBudget);
        recentFinal = recent.map((turn, index) => condenseTurn(turn, caps[index])).join('');
    }

    const middleBudget = bodyLimit - headText.length - recentFinal.length;
    let condensedTurns = 0;
    let droppedTurns = 0;
    let middleText = '';

    if (middle.length && middleBudget > 240) {
        const caps = allocateBudget(middle.map((turn) => turn.length), middleBudget);
        middleText = middle
            .map((turn, index) => {
                if (turn.length <= caps[index]) return turn;
                condensedTurns += 1;
                return condenseTurn(turn, caps[index]);
            })
            .join('');
    }

    let body = headText + middleText + recentFinal;
    if (body.length > bodyLimit) {
        // Still over: drop middle turns oldest-first, but never silently.
        const kept = middle.slice();
        while (kept.length > 0) {
            kept.shift();
            droppedTurns += 1;
            const budgetForKept = Math.max(240, bodyLimit - headText.length - recentFinal.length);
            const caps = allocateBudget(kept.map((turn) => turn.length), budgetForKept);
            const rebuilt = headText
                + kept.map((turn, index) => condenseTurn(turn, caps[index])).join('')
                + recentFinal;
            if (rebuilt.length + omissionLine(droppedTurns).length <= bodyLimit) {
                body = rebuilt + omissionLine(droppedTurns);
                break;
            }
            body = rebuilt;
        }
        if (body.length > bodyLimit) body = truncateMiddle(body, bodyLimit, 0.3);
    }

    return result(withNotice(body), { condensedTurns, droppedTurns });
}

/**
 * Bound one history entry (a user prompt or an assistant reply) for replay when
 * a remote session has to be rebuilt. Keeps both ends: the opening instruction
 * is usually the task, the tail is usually where the work stopped.
 */
function boundHistoryText(text, cap = 3000) {
    const value = String(text || '');
    const limit = Math.max(200, Math.floor(Number(cap) || 0));
    if (value.length <= limit) return value;
    return truncateMiddle(value, limit, 0.5);
}

module.exports = {
    COMPACTION_NOTICE,
    CONDENSE_MARKER,
    splitTurns,
    turnKind,
    extractAnchors,
    truncateMiddle,
    condenseTurn,
    structuredCompact,
    boundHistoryText,
    omissionLine,
};
