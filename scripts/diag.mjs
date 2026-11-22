// Diagnóstico: mostra o que está salvo no servidor (sem dados sensíveis)
import admin from 'firebase-admin';
const SA = JSON.parse(process.env.FIREBASE_SA);
admin.initializeApp({ credential: admin.credential.cert(SA), projectId: 'jaaacked-agenda' });
const U = admin.firestore().collection('users').doc('jaaacked');
const items = (await U.collection('items').get()).docs.map(d => d.data());
const cats = (await U.collection('cats').get()).docs.map(d => d.data());
const subs = (await U.collection('subs').get()).size;
console.log('Projeto:', SA.project_id, '| itens:', items.length, '| categorias:', cats.length, '| aparelhos com notificação:', subs);
console.log('Categorias:', cats.map(c => c.name).join(', '));
const fmt = t => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'nunca';
items.sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 15).forEach(it =>
  console.log('ALTERADO', fmt(it.updated), '|', it.date, '|', (it.title || '').slice(0, 40), '|', it.cat));
process.exit(0);
