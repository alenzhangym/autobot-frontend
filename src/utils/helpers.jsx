import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAppStore } from '../store/useAppStore';

// ── Clean script src in HTML ─────────────────────────────────────────────────
export const cleanScriptSrc = (html) => {
  if (!html || typeof html !== 'string') return html;
  let fixed = html
    .replace(/%22/g, '"')
    .replace(/%27/g, "'")
    .replace(/%2F/g, '/')
    .replace(/%3A/g, ':')
    .replace(/%3A%3A/g, '::')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Fix any remaining quote issues
  fixed = fixed.replace(/(src|href)\s*=\s*"([^"]+)"/g, (match, attr, value) => {
    if ((value.startsWith('http://') || value.startsWith('https://')) && 
        (value.includes('"') || value.includes("'"))) {
      value = value.replace(/["']/g, '');
    }
    return `${attr}="${value}"`;
  });

  // Convert relative paths to CDN URLs for common libraries
  const pathToCdn = {
    '/echarts.min.js': 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js',
    '/echarts.min.js.map': 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js.map',
    '/echarts.simple.min.js': 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.simple.min.js',
  };

  for (const [path, cdn] of Object.entries(pathToCdn)) {
    fixed = fixed.replace(new RegExp(`src=["']?${path}["']?`, 'gi'), `src="${cdn}"`);
  }

  return fixed;
};

// ── Shared UI HTML Wrapper ───────────────────────────────────────────────────
export const wrapUiHtml = (html) => {
  if (!html || typeof html !== 'string') return html;
  html = cleanScriptSrc(html);
  const bridge = `
<script>
(function(){
  try {
    const defineReduce = (proto, impl) => {
      try {
        if (!proto.reduce) {
          Object.defineProperty(proto, 'reduce', { value: impl, writable: true, configurable: true });
        }
      } catch(e){}
    };
    defineReduce(Object.prototype, function(cb, init){
      const arr = Object.values(this);
      return arguments.length >= 2 ? arr.reduce(cb, init) : arr.reduce(cb);
    });
    defineReduce(String.prototype, function(cb, init){
      const arr = Array.from(this);
      return arguments.length >= 2 ? arr.reduce(cb, init) : arr.reduce(cb);
    });

    // Data store access via IndexedDB (replaces window.localDataStore)
    window.__getDataFromIndexedDB = async function(id) {
      try {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('autobot_data_store', 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('store')) {
              req.result.createObjectStore('store');
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('store', 'readonly');
        const store = tx.objectStore('store');
        const result = await new Promise((resolve, reject) => {
          const r = store.get(id);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        return result !== undefined ? result : undefined;
      } catch (e) {
        return undefined;
      }
    };
    const getBackendBaseUrl = function() {
      try {
        const host = (window.parent && window.parent.localStorage) ? window.parent.localStorage.getItem('backend_host') : null;
        if (host && typeof host === 'string' && host.trim()) {
          const h = host.trim();
          if (h.startsWith('http://') || h.startsWith('https://')) return h;
          return 'http://' + h;
        }
      } catch(e){}
      try {
        const p = (window.parent && window.parent.location) ? window.parent.location : null;
        const hostname = (p && p.hostname) ? p.hostname : window.location.hostname;
        return 'http://' + hostname + ':8000';
      } catch(e){}
      return 'http://127.0.0.1:8000';
    };
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = async function(input, init){
        try {
          const url = (typeof input === 'string') ? input : (input && input.url) ? input.url : '';
          if (url && url.includes('/api/data-store/')) {
            const storedId = url.split('/api/data-store/')[1]?.split('?')[0];
            const data = await window.__getDataFromIndexedDB(storedId);
            if (data !== undefined) {
              return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
          }
        } catch(e){}
        let rewrittenInput = input;
        try {
          const base = getBackendBaseUrl();
          if (typeof input === 'string') {
            if (input.startsWith('/api/data-store/')) {
              rewrittenInput = base + input;
            } else if (input.includes('/api/data-store/')) {
              const idx = input.indexOf('/api/data-store/');
              if (idx >= 0) rewrittenInput = base + input.substring(idx);
            }
          } else if (input && input.url && typeof input.url === 'string' && input.url.includes('/api/data-store/')) {
            const idx = input.url.indexOf('/api/data-store/');
            if (idx >= 0) rewrittenInput = base + input.url.substring(idx);
          }
        } catch(e){}

        const res = await origFetch(rewrittenInput, init);
        try {
          const url = (typeof rewrittenInput === 'string') ? rewrittenInput : (rewrittenInput && rewrittenInput.url) ? rewrittenInput.url : '';
          // Validate response is JSON, not HTML error page
          if (res && res.status === 200 && url && url.includes('/api/data-store/')) {
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
              // Try to get data from IndexedDB as fallback
              const storedId = url.split('/api/data-store/')[1]?.split('?')[0];
              const data = await window.__getDataFromIndexedDB(storedId);
              if (data !== undefined) {
                return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
              }
              return new Response(JSON.stringify({ error: 'Invalid response from server' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
            }
          }
          if (res && res.status === 404 && url && url.includes('/api/data-store/')) {
            const storedId = url.split('/api/data-store/')[1]?.split('?')[0];
            const data = await window.__getDataFromIndexedDB(storedId);
            if (data !== undefined) {
              return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
          }
        } catch(e){}
        return res;
      };
    }
  } catch(e){}
})();
</script>
<style>
  html, body { background: #141414 !important; color: #f0f0f0 !important; }
  a { color: #4ea1ff; }
</style>
`;
  const s = String(html || '');
  // Using local tailwind instead of external CDN to avoid network issues
  const tailwindScript = '<script src="/tailwind.min.js"></script>\n';
  const injectContent = tailwindScript + bridge;
  if (s.toLowerCase().includes('<head>')) return s.replace(/<head>/i, '<head>' + injectContent);
  if (s.toLowerCase().includes('<html')) return s.replace(/<html[^>]*>/i, (m) => m + '<head>' + injectContent + '</head>');
  return '<html><head>' + injectContent + '</head><body>' + s + '</body></html>';
};

// ── Data Profiler (Data Contract Builder) ──────────────────────────────────
export const profileData = (rows) => {
  const schema = { columns: [], summary: {} };
  if (!Array.isArray(rows) || rows.length === 0) return schema;

  const sampleSize = Math.min(rows.length, 50);
  const sample = rows.slice(0, sampleSize);
  const keys = Object.keys(sample[0] || {});

  const dimensions = [];
  const metrics = [];

  keys.forEach(key => {
    let numCount = 0;
    let dateCount = 0;
    let nonNullCount = 0;
    const uniques = new Set();
    let sum = 0;

    sample.forEach(row => {
      const val = row[key];
      if (val !== null && val !== undefined && val !== '') {
        nonNullCount++;
        uniques.add(String(val));

        if (!isNaN(Number(val))) {
          numCount++;
          sum += Number(val);
        } else if (!isNaN(Date.parse(val))) {
          dateCount++;
        }
      }
    });

    let type = 'string';
    if (nonNullCount > 0) {
      if (numCount / nonNullCount > 0.8) type = 'numeric';
      else if (dateCount / nonNullCount > 0.8) type = 'date';
    }

    if (type === 'numeric') metrics.push(key);
    else dimensions.push(key);

    const colDef = { name: key, type, unique_count_in_sample: uniques.size };
    if (type === 'numeric' && numCount > 0) {
      colDef.sample_avg = sum / numCount;
    }
    schema.columns.push(colDef);
  });

  schema.summary = {
    total_rows: rows.length,
    dimensions,
    metrics
  };

  return schema;
};

// ── Formatting utilities ────────────────────────────────────────────────────
export const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const truncateText = (text, maxLength = 100) => {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

export const extractJsonFromText = (text) => {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && start < end) {
    return text.substring(start, end + 1);
  }
  return null;
};

/**
 * Find a top-level JSON object in `text` using brace-depth tracking.
 *
 * <p>Unlike {@link extractJsonFromText} (which uses naive `lastIndexOf('}')`
 * and breaks on nested `}` characters inside strings or inner objects),
 * this function walks the string character by character and respects
 * JSON string/escape rules. It returns the <b>last</b> top-level JSON
 * object that starts with a literal "{", or null if none is found.</p>
 *
 * <p>Used to safely extract the trailing analysis-state JSON (e.g.
 * `{"__state": "AWAITING_COMMANDS", ...}`) from a free-form agent
 * message without crashing on nested structures or special characters.</p>
 *
 * @param {string} text - the input text to scan
 * @param {number} fromIndex - optional; start scanning from this position
 * @returns {string|null} the extracted JSON substring, or null
 */
export const extractTrailingJsonObject = (text, fromIndex = 0) => {
  if (!text || typeof text !== 'string') return null;
  const start = text.indexOf('{', fromIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaping) { escaping = false; continue; }
    if (ch === '\\') { escaping = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

/**
 * Extract the trailing `{"__state": ...}` block from a message payload,
 * using proper depth tracking (NOT naive lastIndexOf).
 *
 * @param {string} content - the raw message text
 * @returns {string|null} the JSON state string, or null if not present
 */
export const extractTrailingStateJson = (content) => {
  if (!content || typeof content !== 'string') return null;
  const marker = '"__state"';
  const idx = content.indexOf(marker);
  if (idx < 0) return null;
  // Walk backwards from `marker` to find the opening `{` (depth=1)
  let braceStart = -1;
  for (let i = idx; i >= 0; i -= 1) {
    if (content[i] === '{') {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) return null;
  return extractTrailingJsonObject(content, braceStart);
};

/**
 * Strip the trailing `{"__state": ...}` block from a message payload
 * using proper depth tracking. Replaces the previous implementation that
 * used `lastIndexOf(stateJson)` (which could match the wrong occurrence
 * if the state JSON appeared earlier in the content).
 *
 * @param {string} content - the raw message text
 * @returns {string} the content with the trailing state JSON removed
 */
export const stripTrailingStateJson = (content) => {
  if (!content || typeof content !== 'string') return content;
  const stateJson = extractTrailingStateJson(content);
  if (!stateJson) return content;
  const idx = content.lastIndexOf(stateJson);
  if (idx < 0) return content;
  return content.slice(0, idx);
};

/**
 * Try to extract a structured analysis-result JSON block from arbitrary text.
 * The CodeAnalysisAgent final round emits a JSON object with one or more of
 * {modules, linkages, issues, recommendations} arrays.  We accept:
 *   - bare JSON
 *   - JSON inside ```json ... ``` fences
 *   - JSON preceded/followed by prose
 * Returns { parsed, prefix, suffix } on success, or null if no such block
 * is present (so the caller can fall through to the markdown / HTML path).
 */
export function tryParseAnalysisResult(content) {
  if (!content || typeof content !== 'string') return null
  let text = content.trim()
  if (!text) return null
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaping = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (escaping) { escaping = false; continue }
    if (ch === '\\') { escaping = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const candidate = text.slice(start, i + 1)
        let parsed
        try {
          parsed = JSON.parse(candidate)
        } catch (e) {
          return null
        }
        const hasShape = parsed && typeof parsed === 'object' && (
          Array.isArray(parsed.modules) ||
          Array.isArray(parsed.linkages) ||
          Array.isArray(parsed.issues) ||
          Array.isArray(parsed.recommendations)
        )
        if (!hasShape) return null
        return {
          parsed,
          prefix: text.slice(0, start).trim(),
          suffix: text.slice(i + 1).trim()
        }
      }
    }
  }
  return null
}

// ── HTML entity decoding ────────────────────────────────────────────────────
export const decodeHtmlEntities = (str) => {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
};

// ── HTML content detection ──────────────────────────────────────────────────
export const isHtmlContent = (str) => {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim().toLowerCase();
  // Direct HTML document detection
  if (s.startsWith('<!doctype') || s.startsWith('<html')) return true;
  // LLM may wrap HTML in JSON: {"html": "<html>..."}
  if (s.startsWith('{') && s.includes('"html"') && s.includes('<html')) return true;
  // UIAgent output wrapped in markdown code fences
  if (s.startsWith('```') && (s.includes('<html') || s.includes('<!doctype'))) return true;
  // HTML fragment from ERP agents (e.g. OrderAgent.buildSelectionHtml, OutboundAgent)
  if (s.startsWith('<div')) return true;
  return false;
};

// ── Data store helpers ──────────────────────────────────────────────────────
export function extractDataStoreIds(htmlContent) {
  if (!htmlContent || typeof htmlContent !== 'string') return [];
  const dataStoreRegex = /data_\d+_\w+_manifest|data_\d+_\w+/g;
  const matches = htmlContent.match(dataStoreRegex);
  return matches ? [...new Set(matches)] : [];
}

export function isValidDataStoreResponse(response, data) {
  if (!response.ok || !data) return false;
  if (typeof data !== 'object' || data === null) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (data.type === 'data_store_manifest') return Array.isArray(data.datasets);
  return Object.keys(data).length > 0;
}

export async function fetchMissingDataFromServer(dataIds) {
  const backendHost = window.localStorage.getItem('backend_host') || 
    (import.meta.env.VITE_BACKEND_HOST ? import.meta.env.VITE_BACKEND_HOST.replace(/\/$/, '') : null) ||
    window.location.hostname + ':8000';
  
  const fetchPromises = dataIds.map(async (id) => {
    try {
      const response = await fetch(`${backendHost}/api/data-store/${encodeURIComponent(id)}`);
      
      // Check content type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn(`Skipping ${id}: not JSON (content-type: ${contentType})`);
        return null;
      }
      
      const text = await response.text();
      
      // Verify it's valid JSON (not HTML error page)
      if (text.trim().startsWith('<') || text.trim().startsWith('<!doctype')) {
        console.warn(`Skipping ${id}: server returned HTML instead of JSON`);
        return null;
      }
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.warn(`Skipping ${id}: invalid JSON response`);
        return null;
      }
      
      // Validate data structure
      if (!isValidDataStoreResponse(response, data)) {
        console.warn(`Skipping ${id}: invalid data structure`);
        return null;
      }
      
      return { id, data };
    } catch (err) {
      console.warn(`Failed to fetch data store ${id} from server:`, err);
    }
    return null;
  });
  
  const results = await Promise.all(fetchPromises);
  return results.filter(r => r !== null);
}

export function injectDataStoreData(htmlContent, dataStoreData) {
  if (!htmlContent || typeof htmlContent !== 'string') return htmlContent;
  
  if (!dataStoreData || Object.keys(dataStoreData).length === 0) return htmlContent;
  
  const dataInjectionScript = `
    <script>
      window.__injectedDataStore = ${JSON.stringify(dataStoreData)};
    </script>
  `;
  
  if (htmlContent.toLowerCase().includes('<head>')) {
    return htmlContent.replace(/<head>/i, '<head>' + dataInjectionScript);
  }
  
  if (htmlContent.toLowerCase().includes('<html')) {
    return htmlContent.replace(/<html[^>]*>/i, (m) => m + '<head>' + dataInjectionScript + '</head>');
  }
  
  return '<html><head>' + dataInjectionScript + '</head><body>' + htmlContent + '</body></html>';
}

// ── Markdown renderer ──────────────────────────────────────────────────────
/**
 * Strip __CMD__{...} blocks from text using depth-tracking JSON extraction.
 */
export function stripCommandBlocks(text) {
  if (!text || typeof text !== 'string') return text
  let result = ''
  let remaining = text
  while (remaining.length > 0) {
    const cmdIdx = remaining.indexOf('__CMD__')
    if (cmdIdx < 0) { result += remaining; break }
    result += remaining.slice(0, cmdIdx)
    const afterCmd = cmdIdx + 7
    if (remaining[afterCmd] === '{') {
      const cmdJson = extractTrailingJsonObject(remaining, afterCmd)
      if (cmdJson) {
        remaining = remaining.slice(afterCmd + cmdJson.length)
        continue
      }
    }
    const nextNewline = remaining.indexOf('\n', afterCmd)
    remaining = nextNewline >= 0 ? remaining.slice(nextNewline + 1) : ''
  }
  return result
}

/**
 * Strip agent command markers (__CMD__{...}), [COMMAND_RESULTS] sections,
 * and trailing `{"__state":...}` JSON from message content for display.
 */
export function stripAgentMarkers(content) {
  if (!content || typeof content !== 'string') return content
  let cleaned = stripCommandBlocks(content)
  const commandResultsIdx = cleaned.indexOf('[COMMAND_RESULTS]')
  if (commandResultsIdx >= 0) {
    cleaned = cleaned.substring(0, commandResultsIdx)
  }
  cleaned = stripTrailingStateJson(cleaned)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  return cleaned.trim()
}

export function MarkdownContent({ content }) {
  return (
    <div className="markdown-content" style={{ color: '#e3e3e3', fontSize: 14, lineHeight: 1.6 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const codeStr = String(children).replace(/\n$/, '');

            // Render HTML code blocks in an iframe
            if (!inline && match && match[1] === 'html' && (codeStr.includes('<!DOCTYPE html>') || codeStr.includes('<html'))) {
              return (
                <div style={{ marginTop: 16, marginBottom: 16 }}>
                  <iframe
                    style={{
                      width: '100%',
                      height: 450,
                      border: '1px solid #2a2a2a',
                      borderRadius: 6,
                      backgroundColor: '#141414'
                    }}
                    srcDoc={wrapUiHtml(codeStr)}
                    sandbox="allow-scripts allow-same-origin"
                  />
                </div>
              );
            }

            if (!inline && match) {
              return (
                <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" {...props}>
                  {codeStr}
                </SyntaxHighlighter>
              );
            }
            return (
              <code style={{ background: '#222', padding: '2px 6px', borderRadius: 4, fontSize: 13 }} {...props}>
                {children}
              </code>
            );
          },
          a({ node, ...props }) {
            const href = props.href || '';
            const docMatch = href.match(/\/api\/documents\/([^/]+)\/download/);
            if (docMatch) {
              const docId = docMatch[1];
              const label = String(props.children || docId);
              // Extract fileType from filename extension for document preview
              const fileType = label.includes('.') ? label.split('.').pop()?.toLowerCase() : undefined;
              const { setCurrentDoc, setPreviewOpen } = useAppStore();
              const handlePreview = (e) => {
                e.preventDefault();
                e.stopPropagation();
                setCurrentDoc({ id: docId, filename: label, fileType });
                setPreviewOpen(true);
              };
              return (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: '#1a1a1a', border: '1px solid #2a2a2a',
                  borderRadius: 8, padding: '6px 12px', margin: '4px 0',
                  cursor: 'default',
                }} onClick={handlePreview}>
                  <span style={{ fontSize: 14 }}>📄</span>
                  <span style={{ color: '#e3e3e3', fontSize: 13 }}>{label}</span>
                  <span style={{
                    color: '#4ea1ff', fontSize: 11,
                    padding: '2px 8px', border: '1px solid #4ea1ff44',
                    borderRadius: 4,
                  }}>预览</span>
                </span>
              );
            }
            return <a style={{ color: '#4ea1ff' }} {...props} />;
          },
          table({ node, ...props }) {
            return (
              <div style={{ overflowX: 'auto', margin: '12px 0' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }} {...props} />
              </div>
            );
          },
          th({ node, ...props }) {
            return <th style={{ border: '1px solid #333', padding: '8px', background: '#1a1a1a' }} {...props} />;
          },
          td({ node, ...props }) {
            return <td style={{ border: '1px solid #333', padding: '8px' }} {...props} />;
          },
          blockquote({ node, ...props }) {
            return <blockquote style={{ borderLeft: '3px solid #1677ff', paddingLeft: 12, margin: '12px 0', color: '#888' }} {...props} />;
          },
          ul({ node, ...props }) {
            return <ul style={{ paddingLeft: 20, margin: '8px 0' }} {...props} />;
          },
          li({ node, ...props }) {
            return <li style={{ margin: '4px 0' }} {...props} />;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
