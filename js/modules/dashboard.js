import { db, collection, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, currentMonthRef, monthRefFromDate, CATEGORIAS_GASTOS, renderMonthSelector } from '../helpers.js';

const rendasCol = collection(db, 'rendas');
const contasFixasCol = collection(db, 'contasFixas');
const baixasFixasCol = collection(db, 'contasFixasBaixas');
const variaveisCol = collection(db, 'despesasVariaveis');
const mercadoComprasCol = collection(db, 'mercadoCompras');
const lancamentosCartaoCol = collection(db, 'cartaoLancamentos');

export async function renderDashboard(container) {
  const unsubs = [];
  let selectedMonth = currentMonthRef();
  let filtroPessoa = 'TODOS';
  let filtroCategoria = 'TODAS';

  function renderView() {
    container.innerHTML = `
      <h2 class="module-title">Dashboard Analítico</h2>
      <div id="month-selector-container"></div>

      <!-- Filtros Personalizados -->
      <div class="card">
        <h3>Filtros de Análise</h3>
        <div class="grid grid-2">
          <div>
            <label>Filtrar por Pessoa</label>
            <select id="dash-filtro-pessoa">
              <option value="TODOS">Casal (Todos)</option>
              <option value="Daniel">Daniel</option>
              <option value="Natasha">Natasha</option>
            </select>
          </div>
          <div>
            <label>Filtrar por Categoria</label>
            <select id="dash-filtro-categoria">
              <option value="TODAS">Todas as Categorias</option>
              ${CATEGORIAS_GASTOS.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Resumo Principal -->
      <div class="card">
        <h3>Resumo Financeiro (${selectedMonth})</h3>
        <div class="grid grid-4" id="dash-resumo-grid"></div>
      </div>

      <!-- Gráfico / Barras de Gastos por Categoria -->
      <div class="card">
        <h3>Gastos por Categoria</h3>
        <div id="dash-categorias-bars"></div>
      </div>
    `;

    const monthSelector = renderMonthSelector(selectedMonth, (newMonth) => {
      selectedMonth = newMonth;
      renderView();
    });
    container.querySelector('#month-selector-container').appendChild(monthSelector);

    container.querySelector('#dash-filtro-pessoa').value = filtroPessoa;
    container.querySelector('#dash-filtro-categoria').value = filtroCategoria;

    container.querySelector('#dash-filtro-pessoa').addEventListener('change', (e) => {
      filtroPessoa = e.target.value;
      updateCalculations();
    });

    container.querySelector('#dash-filtro-categoria').addEventListener('change', (e) => {
      filtroCategoria = e.target.value;
      updateCalculations();
    });

    // Data stores
    let rendas = [];
    let contasFixas = [];
    let baixasFixas = [];
    let variaveis = [];
    let mercadoCompras = [];
    let lancsCartao = [];

    function updateCalculations() {
      // 1. Rendas
      let totalRenda = 0;
      rendas.filter(r => (r.mesRef || monthRefFromDate(r.data)) === selectedMonth)
            .forEach(r => {
              if (filtroPessoa === 'TODOS' || r.pessoa === filtroPessoa) {
                totalRenda += (r.valor || 0);
              }
            });

      // 2. Contas Fixas
      let totalFixas = 0;
      contasFixas.filter(c => c.recorrencia === 'pontual' ? c.mesCriacao === selectedMonth : (!c.mesCriacao || c.mesCriacao <= selectedMonth))
                 .forEach(c => {
                   const baixa = baixasFixas.find(b => b.contaId === c.id && b.mes === selectedMonth);
                   const val = baixa ? baixa.valorEfetivo : c.valor;
                   if (filtroCategoria === 'TODAS' || c.categoria === filtroCategoria) {
                     totalFixas += val;
                   }
                 });

      // 3. Despesas Variáveis
      let totalVariaveis = 0;
      const catMap = {};

      variaveis.filter(v => monthRefFromDate(v.data) === selectedMonth)
               .forEach(v => {
                 if (filtroCategoria === 'TODAS' || v.categoria === filtroCategoria) {
                   totalVariaveis += v.valor;
                   catMap[v.categoria] = (catMap[v.categoria] || 0) + v.valor;
                 }
               });

      // 4. Mercado
      let totalMercado = 0;
      mercadoCompras.filter(m => monthRefFromDate(m.data) === selectedMonth)
                    .forEach(m => {
                      if (filtroCategoria === 'TODAS' || filtroCategoria === 'Mercado') {
                        totalMercado += m.valorTotal;
                        catMap['Mercado'] = (catMap['Mercado'] || 0) + m.valorTotal;
                      }
                    });

      const totalGastos = totalFixas + totalVariaveis + totalMercado;
      const saldoFinal = totalRenda - totalGastos;

      // Render Resumo Grid
      container.querySelector('#dash-resumo-grid').innerHTML = `
        <div class="ledger-figure">
          <div class="value" style="color:var(--olive)">${formatBRL(totalRenda)}</div>
          <div class="label">Total Entradas / Renda</div>
        </div>
        <div class="ledger-figure">
          <div class="value" style="color:var(--terracota)">${formatBRL(totalFixas)}</div>
          <div class="label">Total Contas Fixas</div>
        </div>
        <div class="ledger-figure">
          <div class="value" style="color:var(--terracota)">${formatBRL(totalVariaveis + totalMercado)}</div>
          <div class="label">Total Variáveis + Mercado</div>
        </div>
        <div class="ledger-figure">
          <div class="value" style="color:${saldoFinal >= 0 ? 'var(--gold)' : 'var(--terracota)'}">${formatBRL(saldoFinal)}</div>
          <div class="label">Balanço Final / Saldo</div>
        </div>
      `;

      // Render Categorias Bars
      const catEl = container.querySelector('#dash-categorias-bars');
      const catKeys = Object.keys(catMap);
      if (!catKeys.length) {
        catEl.innerHTML = '<div class="empty-state">Sem dados de gastos para este mês.</div>';
      } else {
        const maxVal = Math.max(...Object.values(catMap));
        catEl.innerHTML = catKeys.map(cat => {
          const val = catMap[cat];
          const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
          return `
            <div style="margin-bottom:12px;">
              <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
                <span><strong>${cat}</strong></span>
                <span>${formatBRL(val)}</span>
              </div>
              <div style="background:var(--surface-2); height:8px; border-radius:4px; overflow:hidden;">
                <div style="width:${pct}%; background:var(--gold); height:100%;"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Unsubscribers
    unsubs.push(
      onSnapshot(query(rendasCol), s => { rendas = s.docs.map(d => d.data()); updateCalculations(); }),
      onSnapshot(query(contasFixasCol), s => { contasFixas = s.docs.map(d => ({id: d.id, ...d.data()})); updateCalculations(); }),
      onSnapshot(query(baixasFixasCol), s => { baixasFixas = s.docs.map(d => d.data()); updateCalculations(); }),
      onSnapshot(query(variaveisCol), s => { variaveis = s.docs.map(d => d.data()); updateCalculations(); }),
      onSnapshot(query(mercadoComprasCol), s => { mercadoCompras = s.docs.map(d => d.data()); updateCalculations(); })
    );
  }

  renderView();
  return unsubs;
}
