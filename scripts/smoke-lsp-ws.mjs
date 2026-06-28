// LSP-over-WS smoke test: binary frames in both directions
const ws = new WebSocket('ws://localhost:18080/ws/lsp/typescript?ws=E%3A%5Ccode%5Cautobot%5Cautobot-frontend');
ws.binaryType = 'arraybuffer';

function encodeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  return Buffer.concat([header, body]);
}

function parseFrames(buf) {
  // 返回解析出的 message objects + 剩余 buffer
  const out = [];
  while (true) {
    const headerEnd = buf.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = buf.slice(0, headerEnd).toString('ascii');
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) break;
    const len = parseInt(m[1], 10);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + len) break;
    const body = buf.slice(bodyStart, bodyStart + len).toString('utf8');
    try { out.push(JSON.parse(body)); } catch (_) { out.push({ _raw: body }); }
    buf = buf.slice(bodyStart + len);
  }
  return { messages: out, rest: buf };
}

let gotInit = false;
let buf = Buffer.alloc(0);
const log = (...a) => console.log(...a);

ws.addEventListener('open', () => {
  log('OPEN');
  ws.send(encodeMessage({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { processId: null, rootUri: null, capabilities: { workspace: {}, textDocument: {} } },
  }));
});

ws.addEventListener('message', (ev) => {
  const chunk = Buffer.from(ev.data);
  buf = Buffer.concat([buf, chunk]);
  const { messages, rest } = parseFrames(buf);
  buf = rest;
  for (const msg of messages) {
    log('MSG', JSON.stringify(msg).slice(0, 200));
    // 成功：initialize 返 capabilities
    if (msg && msg.id === 1 && msg.result && msg.result.capabilities) {
      gotInit = true;
      ws.send(encodeMessage({ jsonrpc: '2.0', method: 'initialized', params: {} }));
      log('INIT_OK');
    }
    // 失败：initialize 返 JSON-RPC error（说明桥接通了，server 收到我们的请求了）
    else if (msg && msg.id === 1 && msg.error) {
      gotInit = true;
      log('INIT_REJECTED_BY_LSP (bridge works, server rejected request)');
    }
  }
});

ws.addEventListener('error', (e) => { log('ERR', e.message); process.exit(1); });
ws.addEventListener('close', (ev) => {
  log('CLOSE', ev.code, ev.reason);
  process.exit(gotInit ? 0 : 2);
});

setTimeout(() => {
  if (gotInit) { ws.close(1000, 'ok'); }
  else { log('TIMEOUT no init reply'); ws.close(); process.exit(3); }
}, 12000);
