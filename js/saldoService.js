import { db, doc, getDoc, updateDoc } from './firebase-config.js';
import { todayISO } from './helpers.js';

// Aplica um delta (positivo ou negativo) ao saldo atual de uma conta bancária.
// Retorna o novo saldo, ou null se a conta não existir / contaId vazio.
export async function ajustarSaldoConta(contaId, delta) {
  if (!contaId || !delta) return null;
  const ref = doc(db, 'contasBancarias', contaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const atual = snap.data().saldoAtual || 0;
  const novo = atual + delta;
  await updateDoc(ref, { saldoAtual: novo, saldoAtualizadoEm: todayISO() });
  return novo;
}
