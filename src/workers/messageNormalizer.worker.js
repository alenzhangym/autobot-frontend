import { extractTrailingStateJson, stripAgentMarkers, tryParseAnalysisResult } from '../utils/helpers.jsx';

self.onmessage = (event) => {
  const { messages } = event.data;
  try {
    const normalized = messages.map((msg) => {
      if (msg.role !== 'assistant' || typeof msg.content !== 'string') return msg;
      let state = null;
      let analysisResult = null;
      let displayContent = null;
      try {
        const stateJson = extractTrailingStateJson(msg.content);
        if (stateJson) state = JSON.parse(stateJson);
      } catch (e) { /* ignore parse errors */ }
      try {
        analysisResult = tryParseAnalysisResult(msg.content);
      } catch (e) { /* ignore parse errors */ }
      try {
        displayContent = stripAgentMarkers(msg.content);
      } catch (e) { /* ignore parse errors */ }
      return { ...msg, __cmd: { state, analysisResult, displayContent, hasCommands: msg.content.includes('__CMD__') } };
    });
    self.postMessage({ normalized });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
