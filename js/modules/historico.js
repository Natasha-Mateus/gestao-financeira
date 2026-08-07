import { db, collection, onSnapshot, query } from '../firebase-config.js';
import { formatDate, monthPickerHTML, wireMonthPicker, currentMonthRef, monthRefFromDate } from '../helpers.js';

const historicoCol = collection(db, 'historico');

const ENTIDADES = ['Conta', 'Entrada', 'Reserva', 'Receita recorrente'];
const ACOES = ['criar', 'editar', 'remover'];

export function renderHistorico(container) {
  const unsubs = [];
  let mes = currentMonthRef();
  let filtroEntidade = 'todas';
  let filtroAcao = 'todas';
  let busca = '';

  container.innerHTML = `
    <h2 class="module-title">Histórico</h2>
    <p style="color:var(--text-dim); font-size:13px; margin-top:-14px">Registro de alterações feitas em Renda e Reservas (contas, entradas, reservas e receitas recorrentes).</p>

    <div id="mp-slot-hist">${monthPickerHTML(mes)}</div>
    <div class="filters-bar">
      <select id="filtro-entidade-hist">
        <option value="todas">Todos os tipos</option>
        ${ENTIDADES.map(e => `<option value="${e}">${e}</option>`).join('')}
      </select>
      <select id="filtro-acao-hist">
        <option value="todas">Todas as ações</option>
        ${ACOES.map(a => `<option value="${a}">${a.charAt(0).toUpperCase() + a.slice(1)}</option>`).join('')}
      </select>
      <input type="text" id="filtro-busca-hist" placeholder="Buscar na descrição..." style="margin-bottom:0; min-width:220px">
    </div>
    <div id="lista-historico"></div>
  `;

  function refreshMonthPicker() {
    document.getElementById('mp-slot-hist').innerHTML = monthPickerHTML(mes);
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; refreshMonthPicker(); render(); });
  }
  refreshMonthPicker();

  document.getElementById('filtro-entidade-hist').addEventListener('change', (e) => {
    filtroEntidade = e.target.value;
    render();
  });
  document.getElementById('filtro-acao-hist').addEventListener('change', (e) => {
    filtroAcao = e.target.value;
    render();
  });
  document.getElementById('filtro-busca-hist').addEventListener('input', (e) => {
    busca = e.target.value.toLowerCase();
    render();
  });

  let todosRegistros = [];

  function render() {
    let registros = todosRegistros.filter(r => monthRefFromDate(r.data) === mes);
    if (filtroEntidade !== 'todas') registros = registros.filter(r => r.entidade === filtroEntidade);
    if (filtroAcao !== 'todas') registros = registros.filter(r => r.acao === filtroAcao);
    if (busca) registros = registros.filter(r => (r.descricao || '').toLowerCase().includes(busca));
    registros.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    const el = document.getElementById('lista-historico');
    if (!registros.length) {
      el.innerHTML = '<div class="empty-state">Nenhum registro encontrado com esses filtros.</div>';
      return;
    }

    const corAcao = { criar: 'var(--olive)', editar: 'var(--blue-strong)', remover: 'var(--terracota)' };

    el.innerHTML = `
      <table>
        <thead><tr><th>Data</th><th>Hora</th><th>Tipo</th><th>Ação</th><th>Descrição</th></tr></thead>
        <tbody>
          ${registros.map(r => {
            const hora = r.timestamp ? new Date(r.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';
            return `
            <tr>
              <td>${formatDate(r.data)}</td>
              <td>${hora}</td>
              <td><span class="tag">${r.entidade}</span></td>
              <td><span class="tag" style="color:${corAcao[r.acao] || 'var(--text)'}">${r.acao}</span></td>
              <td>${r.descricao}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  const unsub = onSnapshot(query(historicoCol), (snap) => {
    todosRegistros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });
  unsubs.push(unsub);

  return unsubs;
}
