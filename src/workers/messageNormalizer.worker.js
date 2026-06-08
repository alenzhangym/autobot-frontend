import { extractTrailingStateJson, stripAgentMarkers, extractAnalysisState, tryParseAnalysisResult, getLastParseError } from '../utils/helpers.jsx';

const MAX_SAMPLE_LEN = 120;
const MAX_ERRORS = 50;

function sample(content, maxLen = MAX_SAMPLE_LEN) {
  if (!content) return '(empty)';
  const s = String(content);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '\u2026(' + s.length + ' total)';
}

self.onmessage = (event) => {
  const { messages } = event.data;
  try {
    const parseErrors = [];
    const normalized = [];
    // Process in chunks to avoid blocking the worker thread on huge histories
    const CHUNK = 200;
    for (let offset = 0; offset < messages.length; offset += CHUNK) {
      const batch = messages.slice(offset, offset + CHUNK);
      for (let bi = 0; bi < batch.length; bi++) {
        const idx = offset + bi;
        const msg = batch[bi];
        if (msg.role !== 'assistant' || typeof msg.content !== 'string') {
          normalized.push(msg);
          continue;
        }

        let state = null;
        let analysisResult = null;
        let displayContent = null;
        const msgErrors = [];

        // State extraction via shared extractAnalysisState (single source of truth)
        try {
          state = extractAnalysisState(msg.content);
        } catch (e) {
          msgErrors.push({ field: 'state', error: 'exception: ' + e.message });
        }
        const extractErr = getLastParseError();
        if (extractErr) msgErrors.push({ field: 'state', error: extractErr.detail, sample: sample(msg.content, 200) });

        // Analysis result extraction
        try {
          analysisResult = tryParseAnalysisResult(msg.content);
        } catch (e) {
          msgErrors.push({ field: 'analysisResult', error: 'exception: ' + e.message });
        }
        const resultExtractErr = getLastParseError();
        if (resultExtractErr) msgErrors.push({ field: 'analysisResult', error: resultExtractErr.detail, sample: sample(msg.content, 200) });

        // Display content
        try {
          displayContent = stripAgentMarkers(msg.content);
        } catch (e) {
          msgErrors.push({ field: 'displayContent', error: 'exception: ' + e.message });
        }

        if (msgErrors.length > 0 && parseErrors.length < MAX_ERRORS) {
          parseErrors.push({ msgIndex: idx, errors: msgErrors });
        }

        normalized.push({
          ...msg,
          __cmd: {
            state,
            analysisResult,
            displayContent,
            hasCommands: msg.content.includes('__CMD__{'),
            _parseErrors: msgErrors.length > 0 ? msgErrors : undefined
          }
        });
      }
    }

    self.postMessage({
      normalized,
      errors: parseErrors.length > 0 ? parseErrors : undefined
    });
  } catch (error) {
    self.postMessage({
      error: error.message,
      errors: [{ type: 'WORKER_CRASH', detail: 'Top-level worker failure', error: error.message }]
    });
  }
};
