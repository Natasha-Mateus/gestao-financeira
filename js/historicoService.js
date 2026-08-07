import { db, collection, addDoc } from './firebase-config.js';
import { todayISO } from './helpers.js';

const historicoCol = collection(db, 'historico');

// Registra uma alteração no histórico. Chamado a cada criar/editar/remover
// nas telas que precisam de rastreabilidade (hoje: Renda e Reservas).
export async function registrarHistorico({ modulo, entidade, acao, descricao }) {
  try {
    await addDoc(historicoCol, {
      modulo,
      entidade,
      acao,
      descricao,
      data: todayISO(),
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    // Falha ao registrar histórico não deve travar a ação principal do usuário.
    console.error('Erro ao registrar histórico:', e);
  }
}
