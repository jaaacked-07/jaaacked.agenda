// Envia as notificações da Agenda. Roda pelo GitHub Actions a cada 30 minutos.
// Precisa do segredo FIREBASE_SA (chave da conta de serviço do Firebase, em JSON).
import admin from 'firebase-admin';

if (!process.env.FIREBASE_SA) { console.log('FIREBASE_SA não configurado; nada a fazer.'); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore();
const U = db.collection('users').doc('jaaacked');
const TZ = 'America/Sao_Paulo';
const WINDOW = 100; // minutos de tolerância (o agendador do GitHub pode atrasar)

const DEF = { enabled: true, morning: '07:30', evening: '20:00', ahead: '09:00', reminders: ['11:00', '15:00', '18:00', '21:00'], muted: [] };
const SEM3 = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function nowSP() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
}
const toMin = hhmm => { if (!hhmm) return null; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.toISOString().slice(0, 10); };
const diff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const dateTag = s => { const [y, m, d] = s.split('-').map(Number); const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return `${SEM3[w]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`; };
const plural = (n, a, b) => n === 1 ? a : b;
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

const now = nowSP();
const today = now.date, tomorrow = addDays(today, 1);

const [itemsSnap, catsSnap, tokSnap, notifDoc, logDoc] = await Promise.all([
  U.collection('items').get(), U.collection('cats').get(), U.collection('tokens').get(),
  U.collection('meta').doc('notif').get(), U.collection('meta').doc('sentlog').get()
]);
const cfg = Object.assign({}, DEF, notifDoc.exists ? notifDoc.data() : {});
if (cfg.enabled === false) { console.log('Notificações desligadas.'); process.exit(0); }
const tokens = tokSnap.docs.map(d => ({ ref: d.ref, token: d.data().token })).filter(t => t.token);
if (!tokens.length) { console.log('Nenhum aparelho registrado.'); process.exit(0); }

const cats = Object.fromEntries(catsSnap.docs.map(d => [d.id, d.data()]));
const short = id => { const c = cats[id] || { name: '' }; return (c.short && c.short.trim()) || (c.name || '').split(/[\s·]+/)[0].slice(0, 9); };
const muted = new Set(cfg.muted || []);
const items = itemsSnap.docs.map(d => d.data()).filter(it => it && it.date && !muted.has(it.cat) && it.alert !== 'nao');

const log = logDoc.exists ? (logDoc.data().sent || {}) : {};
const sentNow = {};
const rank = it => (it.type === 'evento' && it.time ? 0 : it.type === 'prazo' ? 1 : it.type === 'evento' ? 2 : 3);
const order = (a, b) => rank(a) - rank(b) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title);
const line = it => clip(`${short(it.cat)} · ${it.note || (it.start ? 'até ' + dateTag(it.date) : dateTag(it.date))}`, 140);
const pendingOf = it => !it.done && it.type !== 'aviso';

const todayItems = items.filter(it => it.date === today && !it.done).sort(order);
const late = items.filter(it => pendingOf(it) && it.date < today && it.date >= addDays(today, -30)).sort((a, b) => a.date.localeCompare(b.date));
const pending = [...items.filter(it => it.date === today && pendingOf(it)).sort(order), ...late];
const badge = pending.length;

const out = [];
const due = (key, hhmm) => { const m = toMin(hhmm); return m !== null && now.min >= m && now.min - m <= WINDOW && !log[`${today}|${key}`]; };
const push = (key, it, title, body) => { out.push({ key, data: { title: clip(title, 90), body, tag: key, id: it ? it.id : '', date: it ? it.date : '', start: it ? (it.start || '') : '', badge: String(badge) } }); };

// 1. Resumo do dia: um compromisso + quantos mais
if (due('morning', cfg.morning) && todayItems.length) {
  const it = todayItems[0], more = todayItems.length - 1;
  let body = line(it);
  if (more > 0) body += `\nMais ${more} ${plural(more, 'compromisso agendado', 'compromissos agendados')} para hoje`;
  if (late.length) body += `\n${late.length} ${plural(late.length, 'pendente', 'pendentes')} de dias anteriores`;
  push('morning', it, `Hoje: ${it.title}`, body);
}

// 2. Lembretes de pendências: só se houver algo pendente; alternam entre os itens
(cfg.reminders || []).forEach((hhmm, i) => {
  if (!hhmm || !due('r' + i, hhmm) || !pending.length) return;
  const it = pending[(i + 1) % pending.length], more = pending.length - 1;
  const isLate = it.date < today;
  let body = isLate ? clip(`${short(it.cat)} · ${it.note ? it.note + ' · ' : ''}era para ${dateTag(it.date)}`, 140) : line(it);
  if (more > 0) body += `\nMais ${more} ${plural(more, 'pendente', 'pendentes')}`;
  push('r' + i, it, `${isLate ? 'Atrasado' : 'Pendente'}: ${it.title}`, body);
});

// 3. Prazos chegando (fim de períodos e itens com "avisar 1 ou 3 dias antes")
if (due('ahead', cfg.ahead)) {
  items.filter(it => !it.done).forEach(it => {
    const d = diff(it.date, today);
    const want = it.alert === '1d' ? [1] : it.alert === '3d' ? [3, 1] : (it.start && it.type === 'prazo' ? [3, 1] : []);
    if (want.includes(d)) push('ahead|' + it.id, it, `Faltam ${d} ${plural(d, 'dia', 'dias')}: ${it.title}`, `${short(it.cat)} · até ${dateTag(it.date)}`);
  });
}

// 4. Compromisso com horário: 2 horas antes
items.filter(it => it.date === today && it.time && !it.done).forEach(it => {
  const m = toMin(it.time) - 120;
  const key = 'ev|' + it.id;
  if (now.min >= m && now.min < toMin(it.time) && !log[`${today}|${key}`]) push(key, it, `Às ${it.time}: ${it.title}`, line(it));
});

// 5. Véspera: um compromisso de amanhã + quantos mais
if (due('evening', cfg.evening)) {
  const list = items.filter(it => it.date === tomorrow && !it.done).sort(order);
  if (list.length) {
    const it = list[0], more = list.length - 1;
    push('evening', it, `Amanhã: ${it.title}`, line(it) + (more > 0 ? `\nMais ${more} ${plural(more, 'compromisso agendado', 'compromissos agendados')} para amanhã` : ''));
  }
}

// Envio
const dead = new Set();
for (const n of out.slice(0, 6)) {
  const res = await admin.messaging().sendEachForMulticast({
    tokens: tokens.map(t => t.token),
    data: n.data,
    webpush: { headers: { Urgency: 'high', TTL: '7200' } }
  });
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument' || code === 'messaging/invalid-registration-token') dead.add(i);
      console.log('Falha:', code);
    }
  });
  sentNow[`${today}|${n.key}`] = Date.now();
  console.log('Enviada:', n.data.title);
}
for (const i of dead) await tokens[i].ref.delete().catch(() => {});

// Registro do que já foi enviado (mantém só os últimos 7 dias)
const keep = {};
const cutoff = addDays(today, -7);
for (const [k, v] of Object.entries({ ...log, ...sentNow })) if (k.slice(0, 10) >= cutoff) keep[k] = v;
await U.collection('meta').doc('sentlog').set({ sent: keep });
console.log(`Hora SP ${today} ${Math.floor(now.min / 60)}:${String(now.min % 60).padStart(2, '0')} · ${out.length} notificação(ões).`);
process.exit(0);
