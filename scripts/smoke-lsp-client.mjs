// End-to-end: LspWebSocketClient → backend bridge → typescript-language-server
import { LspWebSocketClient } from '../src/lsp/LspWebSocketClient.js';

const c = new LspWebSocketClient({
  url: 'ws://localhost:18080/ws/lsp/typescript?ws=E%3A%5Ccode%5Cautobot%5Cautobot-frontend',
  languageId: 'typescript',
  rootUri: 'file:///E:/code/autobot/autobot-frontend',
  onState: (s) => console.log('STATE', s),
});
let pass = false;
c.connect();
const start = Date.now();
c.onState = (s) => console.log('STATE', s, `+${Date.now()-start}ms`);
// 等 ready 后再调 hover
const ready = new Promise((resolve) => {
  const orig = c.onState;
  c.onState = (s) => { orig(s); if (s === 'ready') resolve(); };
});
ready.then(() => c.hover(0, 0)).then(() => {
  console.log('hover resolved (unexpected)');
  pass = true;
}).catch((e) => {
  console.log('hover rejected (expected, no ts installed):', String(e).slice(0, 120));
  pass = true; // 收到 error 就算通
}).finally(() => {
  c.dispose();
  setTimeout(() => process.exit(pass ? 0 : 1), 200);
});

setTimeout(() => { console.log('TIMEOUT'); c.dispose(); process.exit(3); }, 10000);
