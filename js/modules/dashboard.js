import { db, collection, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, currentMonthRef, monthRefFromDate, todayISO, daysBetween,
  monthPickerHTML, wireMonthPicker, CATEGORIAS_GASTO, monthsBetween,
  calcularMesFatura, addMonths
} from '../helpers.js';

export function renderDashboard(container) {
  const unsubs = [];
  let mes = currentMonthRef();
  let pessoaFiltro = 'todos';
  let categoriaFiltro = 'todas';

  container.innerHTML = `
    <h2 class="module-title">Dashboard</h2>
    <div id="mp-slot-dash">${monthPickerHTML(mes)}</div>
    <div class="filters-bar">
      <select id="filtro-pessoa-dash">
        <option value="todos">Casal (Natasha + Daniel)</option>
        <option value="Natasha">Só Natasha</option>
        <option value="Daniel">Só Daniel</option>
      </select>
      <select id="filtro-categoria-dash">
        <option value="todas">Todas as categorias</option>
        ${CATEGORIAS_GASTO.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div class="card" style="margin-bottom:24px">
      <h3>Saldo em contas</h3>
      <div class="grid grid-3" id="saldo-resumo-topo" style="margin-top:12px; margin-bottom:16px"></div>
      <div id="saldo-contas-lista"></div>
    </div>
    <div class="grid grid-2" style="margin-bottom:24px">
      <div class="card">
        <h3>Mercado (mês)</h3>
        <div id="card-mercado" style="margin-top:12px"></div>
      </div>
      <div class="card">
        <h3>Cartão de Crédito (mês)</h3>
        <div id="card-cartao" style="margin-top:12px"></div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-bottom:24px">
      <div class="card">
        <h3>Vale Alimentação (Natasha) — isolado do caixa do casal</h3>
        <div id="card-vale" style="margin-top:12px"></div>
      </div>
      <div class="card">
        <h3>Gasto por categoria</h3>
        <div id="card-categorias" style="margin-top:12px"></div>
      </div>
    </div>
    <div class="card">
      <h3>Alertas e pendências</h3>
      <div id="card-alertas" style="margin-top:12px"></div>
    </div>
  `;

  function refreshMonthPicker() {
    document.getElementById('mp-slot-dash').innerHTML = monthPickerHTML(mes);
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; refreshMonthPicker(); carregarTudo(); });
  }
  refreshMonthPicker();

  document.getElementById('filtro-pessoa-dash').addEventListener('change', (e) => { pessoaFiltro = e.target.value; carregarTudo(); });
  document.getElementById('filtro-categoria-dash').addEventListener('change', (e) => { categoriaFiltro = e.target.value; carregarTudo(); });

  let cachedUnsubs = [];
  function carregarTudo() {
    cachedUnsubs.forEach(fn => fn());
    cachedUnsubs = [];

    let totalMercado = 0, totalCartaoManual = 0, totalFixas = 0, totalVariaveis = 0, totalRenda = 0;
    let totalFixasTemplateSum = 0, totalReceitasRecorrentes = 0;
    let contasAtuais = [];
    let categoriaTotais = {};

    function atualizarResumo() {
      atualizarSaldoTopo();
    }

    function atualizarSaldoTopo() {
      let contas = contasAtuais;
      if (pessoaFiltro !== 'todos') contas = contas.filter(c => c.pessoa === pessoaFiltro);
      const saldoAtualReal = contas.reduce((s, c) => s + (c.saldoAtual || 0), 0);

      const mesesAFrente = monthsBetween(currentMonthRef(), mes);
      const listaEl = document.getElementById('saldo-contas-lista');

      if (mesesAFrente > 0) {
        // Mês futuro: mostra Saldo Projetado (cumulativo) em vez do saldo real do mês
        const saldoProjetado = saldoAtualReal + mesesAFrente * (totalReceitasRecorrentes - totalFixasTemplateSum);
        document.getElementById('saldo-resumo-topo').innerHTML = `
          <div class="ledger-figure"><div class="value">${formatBRL(saldoProjetado)}</div><div class="label">Saldo projetado para ${mes}</div></div>
          <div class="ledger-figure"><div class="value" style="color:var(--olive)">${formatBRL(totalReceitasRecorrentes)}</div><div class="label">Receitas recorrentes previstas (mês)</div></div>
          <div class="ledger-figure"><div class="value" style="color:var(--terracota)">${formatBRL(totalFixasTemplateSum)}</div><div class="label">Contas fixas a pagar (mês)</div></div>
        `;
        listaEl.innerHTML = `<p style="color:var(--text-dim); font-size:13px">Projeção: saldo atual (${formatBRL(saldoAtualReal)}) + ${mesesAFrente} mês(es) de receitas recorrentes menos contas fixas. Gastos variáveis, mercado e cartão não entram nessa conta por serem imprevisíveis.</p>`;
        return;
      }

      const totalGastos = totalMercado + totalCartaoManual + totalFixas + totalVariaveis;
      document.getElementById('saldo-resumo-topo').innerHTML = `
        <div class="ledger-figure"><div class="value">${formatBRL(saldoAtualReal)}</div><div class="label">Saldo total em conta agora</div></div>
        <div class="ledger-figure"><div class="value" style="color:var(--olive)">${formatBRL(totalRenda)}</div><div class="label">Entradas do mês</div></div>
        <div class="ledger-figure"><div class="value" style="color:var(--terracota)">${formatBRL(totalGastos)}</div><div class="label">Saídas do mês</div></div>
      `;
      listaEl.innerHTML = contas.length ? contas.map(c => `
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border)">
          <span>${c.nome} <span class="tag">${c.pessoa} · ${c.tipo}</span></span>
          <span>${formatBRL(c.saldoAtual)}</span>
        </div>
      `).join('') : '<div class="empty-state">Nenhuma conta cadastrada.</div>';
    }

    function atualizarCategorias() {
      const el = document.getElementById('card-categorias');
      const entradas = Object.entries(categoriaTotais).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      if (!entradas.length) { el.innerHTML = '<div class="empty-state">Sem dados de categoria nesse recorte.</div>'; return; }
      const max = Math.max(...entradas.map(e => e[1]));
      el.innerHTML = entradas.map(([cat, val]) => `
        <div style="margin-bottom:10px">
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px">
            <span>${cat}</span><span>${formatBRL(val)}</span>
          </div>
          <div style="background:var(--surface-2); border-radius:4px; height:8px; overflow:hidden">
            <div style="width:${(val / max) * 100}%; height:100%; background:var(--gold)"></div>
          </div>
        </div>
      `).join('');
    }

    // Mercado (não filtrado por pessoa/categoria — é sempre do casal)
    // O vale alimentação é isolado do caixa do casal: não conta como gasto real.
    const u1 = onSnapshot(query(collection(db, 'mercadoCompras')), (snap) => {
      const comprasMes = snap.docs.map(d => d.data()).filter(c => monthRefFromDate(c.data) === mes);
      const comprasReais = comprasMes.filter(c => c.formaPagamento !== 'vale');
      const comprasVale = comprasMes.filter(c => c.formaPagamento === 'vale' && c.valeTitular === 'Natasha');

      totalMercado = comprasReais.reduce((s, c) => s + (c.valorTotal || 0), 0);
      if (categoriaFiltro === 'todas' && pessoaFiltro === 'todos') categoriaTotais['Mercado'] = totalMercado;
      else categoriaTotais['Mercado'] = 0;

      document.getElementById('card-mercado').innerHTML = `
        <div class="ledger-figure"><div class="value">${formatBRL(totalMercado)}</div><div class="label">${comprasReais.length} ida(s) ao mercado este mês (Crédito/Pix/Débito/Dinheiro)</div></div>
      `;

      const totalVale = comprasVale.reduce((s, c) => s + (c.valorTotal || 0), 0);
      atualizarCardVale(totalVale, comprasVale.length);

      atualizarResumo(); atualizarCategorias();
    });
    cachedUnsubs.push(u1);

    let valeValorMensal = 0;
    const u1b = onSnapshot(query(collection(db, 'valeAlimentacaoConfig')), (snap) => {
      const configDoMes = snap.docs.map(d => d.data()).find(c => c.mes === mes);
      valeValorMensal = configDoMes ? configDoMes.valorMensal : 0;
      atualizarCardVale();
    });
    cachedUnsubs.push(u1b);

    let ultimoTotalVale = 0, ultimoCountVale = 0;
    function atualizarCardVale(totalVale, count) {
      if (totalVale !== undefined) { ultimoTotalVale = totalVale; ultimoCountVale = count; }
      const restante = valeValorMensal - ultimoTotalVale;
      const percentual = valeValorMensal > 0 ? Math.min(100, (ultimoTotalVale / valeValorMensal) * 100) : 0;
      document.getElementById('card-vale').innerHTML = `
        <div class="grid grid-2">
          <div class="ledger-figure"><div class="value">${formatBRL(ultimoTotalVale)}</div><div class="label">Gasto este mês (${ultimoCountVale} compra(s))</div></div>
          <div class="ledger-figure"><div class="value" style="color:${restante >= 0 ? 'var(--olive)' : 'var(--terracota)'}">${formatBRL(restante)}</div><div class="label">Saldo restante</div></div>
        </div>
        <div style="margin-top:12px; background:var(--surface-2); border-radius:6px; height:8px; overflow:hidden">
          <div style="width:${percentual}%; height:100%; background:${percentual >= 90 ? 'var(--terracota)' : 'var(--gold)'}"></div>
        </div>
        <p style="color:var(--text-dim); font-size:13px; margin-top:10px">Não entra no "Total gasto no mês" do casal — é um benefício à parte.</p>
      `;
    }

    // Cartão: separa lançamentos manuais (não duplicar mercado/variaveis) e monta faturas do mês
    const u2 = onSnapshot(query(collection(db, 'cartoes')), (snapCartoes) => {
      const cartoes = snapCartoes.docs.map(d => ({ id: d.id, ...d.data() }));
      const u2b = onSnapshot(query(collection(db, 'cartaoLancamentos')), (snap) => {
        const lancs = snap.docs.map(d => d.data());
        let totalFaturaMes = 0;
        totalCartaoManual = 0;
        const catManual = {};

        lancs.forEach(l => {
          const cartao = cartoes.find(c => c.id === l.cartaoId);
          if (pessoaFiltro !== 'todos' && cartao && cartao.titular !== pessoaFiltro) return;
          const parcelas = l.parcelado ? l.numParcelas : 1;
          const valorParcela = l.valorTotal / parcelas;
          const mesBase = calcularMesFatura(l.data, cartao?.diaFechamento, cartao?.diaVencimento);
          for (let p = 0; p < parcelas; p++) {
            const key = addMonths(mesBase, p);
            if (key === mes) {
              totalFaturaMes += valorParcela;
              if (l.origem === 'manual') {
                totalCartaoManual += valorParcela;
                if (categoriaFiltro === 'todas' || categoriaFiltro === l.categoria) {
                  catManual[l.categoria] = (catManual[l.categoria] || 0) + valorParcela;
                }
              }
            }
          }
        });

        Object.keys(catManual).forEach(cat => { categoriaTotais[cat] = (categoriaTotais[cat] || 0) + catManual[cat]; });

        document.getElementById('card-cartao').innerHTML = `
          <div class="ledger-figure"><div class="value">${formatBRL(totalFaturaMes)}</div><div class="label">Total das faturas este mês</div></div>
        `;
        atualizarResumo(); atualizarCategorias();
      });
      cachedUnsubs.push(u2b);
    });
    cachedUnsubs.push(u2);

    // Variáveis
    const u3 = onSnapshot(query(collection(db, 'variaveisDespesas')), (snap) => {
      let despesas = snap.docs.map(d => d.data()).filter(v => monthRefFromDate(v.data) === mes);
      if (pessoaFiltro !== 'todos') despesas = despesas.filter(v => v.pessoa === pessoaFiltro || v.pessoa === 'Casal');
      if (categoriaFiltro !== 'todas') despesas = despesas.filter(v => v.categoria === categoriaFiltro);
      totalVariaveis = despesas.reduce((s, v) => s + v.valorTotal, 0);
      despesas.forEach(v => { categoriaTotais[v.categoria] = (categoriaTotais[v.categoria] || 0) + v.valorTotal; });
      atualizarResumo(); atualizarCategorias();
    });
    cachedUnsubs.push(u3);

    // Contas fixas (templates + status do mês)
    const u4 = onSnapshot(query(collection(db, 'contasFixas')), (snapT) => {
      const templates = snapT.docs.map(d => ({ id: d.id, ...d.data() }));
      totalFixasTemplateSum = templates.reduce((s, t) => s + (t.valor || 0), 0);
      const u4b = onSnapshot(query(collection(db, 'contasFixasStatus')), (snapS) => {
        const statusDocs = snapS.docs.map(d => d.data()).filter(s => s.mes === mes);
        let filtrados = templates; // Contas fixas não têm mais responsável — sempre entram, independente do filtro de pessoa
        totalFixas = filtrados.reduce((s, t) => {
          const st = statusDocs.find(x => x.templateId === t.id);
          return st && st.status === 'pago' ? s + t.valor : s;
        }, 0);
        const pendentes = filtrados.filter(t => {
          const st = statusDocs.find(x => x.templateId === t.id);
          return !st || st.status !== 'pago';
        });
        renderAlertas(pendentes);
        atualizarResumo();
      });
      cachedUnsubs.push(u4b);
    });
    cachedUnsubs.push(u4);

    // Receitas recorrentes (base da projeção financeira)
    const u8 = onSnapshot(query(collection(db, 'receitasRecorrentes')), (snap) => {
      totalReceitasRecorrentes = snap.docs.map(d => d.data()).reduce((s, r) => s + (r.valor || 0), 0);
      atualizarResumo();
    });
    cachedUnsubs.push(u8);

    // Itens da despensa há muito tempo em uso (alerta)
    const u5 = onSnapshot(query(collection(db, 'despensaItens')), (snap) => {
      const itens = snap.docs.map(d => d.data()).filter(i => i.status !== 'acabou' && i.dataInicio);
      const emUsoHaMuito = itens.filter(i => daysBetween(i.dataInicio, todayISO()) > 20);
      renderAlertasItens(emUsoHaMuito);
    });
    cachedUnsubs.push(u5);

    // Saldo em contas (alimenta o card do topo)
    const u6 = onSnapshot(query(collection(db, 'contasBancarias')), (snap) => {
      contasAtuais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      atualizarSaldoTopo();
    });
    cachedUnsubs.push(u6);

    // Entradas do mês
    const u7 = onSnapshot(query(collection(db, 'contasBancarias')), (snapContas) => {
      const contas = snapContas.docs.map(d => ({ id: d.id, ...d.data() }));
      const u7b = onSnapshot(query(collection(db, 'entradas')), (snap) => {
        let entradas = snap.docs.map(d => d.data()).filter(e => monthRefFromDate(e.data) === mes);
        if (pessoaFiltro !== 'todos') {
          entradas = entradas.filter(e => {
            const conta = contas.find(c => c.id === e.contaId);
            return conta && conta.pessoa === pessoaFiltro;
          });
        }
        totalRenda = entradas.reduce((s, e) => s + (e.valor || 0), 0);
        atualizarResumo();
      });
      cachedUnsubs.push(u7b);
    });
    cachedUnsubs.push(u7);

    function renderAlertas(pendentes) {
      const el = document.getElementById('card-alertas');
      if (!pendentes.length) {
        el.innerHTML = '<div class="empty-state">Nenhuma conta fixa pendente nesse mês. 🎉</div>';
        return;
      }
      el.innerHTML = pendentes.map(c => `
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border)">
          <span>${c.nome} — vence dia ${c.diaVencimento || '-'}</span>
          <span style="color:var(--terracota)">${formatBRL(c.valor)}</span>
        </div>
      `).join('');
    }

    function renderAlertasItens(itens) {
      if (!itens.length) return;
      const el = document.getElementById('card-alertas');
      const extra = itens.map(i => `
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border)">
          <span>${i.nome}${i.marca ? ' - ' + i.marca : ''} está em uso há ${daysBetween(i.dataInicio, todayISO())} dias</span>
          <span class="tag">verificar estoque</span>
        </div>
      `).join('');
      el.innerHTML += extra;
    }
  }

  carregarTudo();
  unsubs.push(() => cachedUnsubs.forEach(fn => fn()));
  return unsubs;
}
