#!/usr/bin/env node
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const take = () => args[++i];
  switch (a) {
    case '--port':       process.env.PORT              = take(); break;
    case '--repo-root':  process.env.AUTOBOT_REPO_ROOT = take(); break;
    case '--no-monitor': process.env.AUTOBOT_MONITOR   = '0';    break;
    case '--monitor':    process.env.AUTOBOT_MONITOR   = '1';    break;
    case '--no-open':    process.env.NO_OPEN           = '1';    break;
    case '-h': case '--help':
      console.log('autobot-monitor — local agent + UI');
      console.log('');
      console.log('  --port <n>           Port (default 3000)');
      console.log('  --repo-root <path>   Project root to monitor');
      console.log('  --no-monitor         Disable monitor');
      console.log('  --monitor            Force monitor on');
      console.log('  --no-open            Don\'t open browser');
      console.log('');
      console.log('Env: PORT AUTOBOT_REPO_ROOT AUTOBOT_MONITOR NO_OPEN');
      process.exit(0);
    default:
      console.error(`autobot-monitor: unknown flag: ${a}\nTry --help`);
      process.exit(1);
  }
}
import('../server.js').catch(e => {
  console.error('autobot-monitor: failed to start:', e?.stack || e?.message || e);
  process.exit(1);
});
