// Owner CLI — create invitees + print magic links, list usage, extend, stop.
// Zero-dep. Run with Electron's bundled node (see run.sh) or plain node:
//   node src/cli.js create --email a@b.com --name "Anwar" --limit 40 --days 15 --wave 1
//   node src/cli.js list
//   node src/cli.js extend --id <id> --days 7
//   node src/cli.js stop --id <id>
//   node src/cli.js activate --id <id>
//   node src/cli.js bump --id <id> --makes 10

import { config } from './config.js';
import { store, gateStatus, readEvents } from './store.js';

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}
const link = (t) => `${config.publicBaseUrl}/s/${t}`;

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const f = flags(rest);
  switch (cmd) {
    case 'create': {
      if (!f.email) throw new Error('--email required');
      const inv = await store.create({ email: f.email, name: f.name, genLimit: f.limit ? Number(f.limit) : 40, durationDays: f.days ? Number(f.days) : 15, wave: f.wave ? Number(f.wave) : 1 });
      console.log(`\n✓ Created ${inv.name} <${inv.email}>  (wave ${inv.wave})`);
      console.log(`  cap: ${inv.genLimit} makes · ${inv.durationDays} days`);
      console.log(`  MAGIC LINK:  ${link(inv.magicToken)}\n`);
      break;
    }
    case 'list': {
      const events = readEvents();
      const makes = new Map(), logins = new Map();
      for (const e of events) {
        if (e.kind === 'make') makes.set(e.inviteeId, (makes.get(e.inviteeId) || 0) + 1);
        if (e.kind === 'login') logins.set(e.inviteeId, (logins.get(e.inviteeId) || 0) + 1);
      }
      const list = store.list();
      if (!list.length) { console.log('No invitees yet. Use: create --email ...'); break; }
      console.log('\nID        WAVE  NAME                 USED/CAP  DAYS  STATE     ACTIVE  LINK');
      for (const inv of list) {
        const s = gateStatus(inv);
        const state = !inv.active ? 'stopped' : s.reason === 'expired' ? 'expired' : s.reason === 'exhausted' ? 'capped' : 'open';
        const activated = (logins.get(inv.id) || 0) > 0 ? 'yes' : 'no';
        console.log(`${inv.id.padEnd(9)} ${String(inv.wave).padEnd(5)} ${inv.name.slice(0, 19).padEnd(20)} ${`${inv.genUsed}/${inv.genLimit}`.padEnd(9)} ${String(s.daysLeft).padEnd(5)} ${state.padEnd(9)} ${activated.padEnd(7)} ${link(inv.magicToken)}`);
      }
      console.log('');
      break;
    }
    case 'extend': { if (!f.id) throw new Error('--id required'); const inv = await store.extend(f.id, f.days ? Number(f.days) : 7); console.log(inv ? `✓ extended ${inv.name} → ${inv.durationDays} days total` : 'not found'); break; }
    case 'stop': { if (!f.id) throw new Error('--id required'); const inv = await store.setActive(f.id, false); console.log(inv ? `✓ stopped ${inv.name}` : 'not found'); break; }
    case 'activate': { if (!f.id) throw new Error('--id required'); const inv = await store.setActive(f.id, true); console.log(inv ? `✓ re-activated ${inv.name}` : 'not found'); break; }
    case 'bump': { if (!f.id) throw new Error('--id required'); const inv = await store.bumpLimit(f.id, f.makes ? Number(f.makes) : 10); console.log(inv ? `✓ ${inv.name} cap → ${inv.genLimit} makes` : 'not found'); break; }
    default: console.log('Commands: create | list | extend | stop | activate | bump');
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
