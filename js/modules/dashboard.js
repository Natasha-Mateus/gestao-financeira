import { db, collection, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, currentMonthRef, monthRefFromDate, todayISO, daysBetween,
  monthPickerHTML, wireMonthPicker, CATEGORIAS_GASTO, monthsBetween,
  calcularMesFatura, addMonths, valorNaoValeDaCompra
} from '../helpers.js';
import { parcelasPorCompetencia, calcularValeAcumulado } from './cartao.js';

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
      <div class="grid grid-4" id="saldo-resumo-topo" style="margin-top:12px; margin-bottom:16px"></div>
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
        <h3>Despesa por categoria</h3>
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
    let totalFixasPendentes = 0, totalCartaoCompetenciaMes = 0, totalReceitasRecorrentesPendentes = 0, totalEntradasPrevistasNaoEfetivadas = 0;
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
        calcularProjecaoDetalhada(saldoAtualReal, mesesAFrente).then(proj => {
          document.getElementById('saldo-resumo-topo').innerHTML = `
            <div class="ledger-figure"><div class="value">${formatBRL(proj.saldoProjetado)}</div><div class="label">Saldo projetado para ${mes}</div></div>
            <div class="ledger-figure"><div class="value" style="color:var(--olive)">${formatBRL(proj.totalEntradasPrevistas)}</div><div class="label">Entradas previstas (recorrentes + avulsas, ${mesesAFrente} mês(es))</div></div>
            <div class="ledger-figure"><div class="value" style="color:var(--terracota)">${formatBRL(proj.totalSaidasPrevistas)}</div><div class="label">Saídas previstas (${mesesAFrente} mês(es))</div></div>
          `;
          listaEl.innerHTML = `
            <p style="color:var(--text-dim); font-size:13px">Saldo atual (${formatBRL(saldoAtualReal)}) + receitas recorrentes + entradas avulsas previstas − contas fixas − cartão (parcelas e recorrências já lançadas), somado mês a mês até ${mes}. Variáveis e Mercado à vista já registrados não entram aqui porque já foram descontados do saldo atual na hora do lançamento; os pagos no crédito já estão contados dentro do Cartão.</p>
            <div class="grid grid-2" style="margin-top:12px">
              <div class="ledger-figure"><div class="value" style="font-size:16px">${formatBRL(proj.totalFixasPrevisto)}</div><div class="label">Contas fixas</div></div>
              <div class="ledger-figure"><div class="value" style="font-size:16px">${formatBRL(proj.totalCartaoPrevisto)}</div><div class="label">Cartão (já lançado)</div></div>
            </div>
          `;
        });
        return;
      }

      const totalGastos = totalMercado + totalCartaoManual + totalFixas + totalVariaveis;
      const saldoPrevisto = saldoAtualReal + totalReceitasRecorrentesPendentes + totalEntradasPrevistasNaoEfetivadas - totalFixasPendentes - totalCartaoCompetenciaMes;
      document.getElementById('saldo-resumo-topo').innerHTML = `
        <div class="ledger-figure"><div class="value">${formatBRL(saldoAtualReal)}</div><div class="label">Saldo total em conta agora</div></div>
        <div class="ledger-figure"><div class="value" style="color:var(--olive)">${formatBRL(totalRenda)}</div><div class="label">Entradas do mês</div></div>
        <div class="ledger-figure"><div class="value" style="color:var(--terracota)">${formatBRL(totalGastos)}</div><div class="label">Saídas do mês</div></div>
        <div class="ledger-figure"><div class="value" style="color:${saldoPrevisto >= 0 ? 'var(--olive)' : 'var(--terracota)'}">${formatBRL(saldoPrevisto)}</div><div class="label">Saldo previsto (fim do mês)</div></div>
      `;
      listaEl.innerHTML = `
        ${contas.length ? contas.map(c => `
          <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border)">
            <span>${c.nome} <span class="tag">${c.pessoa} · ${c.tipo}</span></span>
            <span>${formatBRL(c.saldoAtual)}</span>
          </div>
        `).join('') : '<div class="empty-state">Nenhuma conta cadastrada.</div>'}
        <p style="color:var(--text-dim); font-size:13px; margin-top:12px">"Saldo previsto" = saldo atual + receitas recorrentes ainda não recebidas + entradas previstas do mês − contas fixas pendentes − cartão (parcelas e recorrências do mês). Variáveis/Mercado à vista já registrados não entram de novo aqui — já estão refletidos no saldo atual.</p>
      `;
    }

    // Calcula a projeção mês a mês entre o mês atual (exclusive) e o mês selecionado (inclusive),
    // considerando receitas recorrentes, contas fixas, variáveis já registradas e cartão (parcelas + recorrências).
    async function calcularProjecaoDetalhada(saldoAtualReal, mesesAFrente) {
      const mesesAlvo = [];
      for (let i = 1; i <= mesesAFrente; i++) mesesAlvo.push(addMonths(currentMonthRef(), i));

      const [snapCartoes, snapLancs, snapRec, snapEntradas] = await Promise.all([
        new Promise(res => { const u = onSnapshot(query(collection(db, 'cartoes')), s => { res(s); u(); }); }),
        new Promise(res => { const u = onSnapshot(query(collection(db, 'cartaoLancamentos')), s => { res(s); u(); }); }),
        new Promise(res => { const u = onSnapshot(query(collection(db, 'cartaoRecorrentes')), s => { res(s); u(); }); }),
        new Promise(res => { const u = onSnapshot(query(collection(db, 'entradas')), s => { res(s); u(); }); })
      ]);

      const cartoesTodos = snapCartoes.docs.map(d => ({ id: d.id, ...d.data() }));
      const lancs = snapLancs.docs.map(d => d.data());
      const recorrentes = snapRec.docs.map(d => d.data());
      const entradasTodas = snapEntradas.docs.map(d => d.data());

      let totalFixasPrevisto = 0, totalCartaoPrevisto = 0, totalEntradasPlanejadas = 0;

      mesesAlvo.forEach(mAlvo => {
        totalFixasPrevisto += totalFixasTemplateSum;

        lancs.forEach(l => {
          const cartao = cartoesTodos.find(c => c.id === l.cartaoId);
          parcelasPorCompetencia(l, cartao).forEach(p => {
            if (p.mes === mAlvo) totalCartaoPrevisto += p.valor;
          });
        });
        recorrentes.forEach(r => {
          if (r.mesInicio && r.mesInicio <= mAlvo) totalCartaoPrevisto += r.valor;
        });

        // Entradas previstas avulsas (não recorrentes), marcadas como "previsto" e ainda não efetivadas, do mês alvo.
        totalEntradasPlanejadas += entradasTodas
          .filter(e => e.previsto && e.efetivada === false && monthRefFromDate(e.data) === mAlvo)
          .reduce((s, e) => s + (e.valor || 0), 0);
      });

      const totalEntradasPrevistas = (mesesAFrente * totalReceitasRecorrentes) + totalEntradasPlanejadas;
      const totalSaidasPrevistas = totalFixasPrevisto + totalCartaoPrevisto;
      const saldoProjetado = saldoAtualReal + totalEntradasPrevistas - totalSaidasPrevistas;

      return { saldoProjetado, totalEntradasPrevistas, totalSaidasPrevistas, totalFixasPrevisto, totalCartaoPrevisto };
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
    let todasComprasMercado = [];
    let todasDespesasVariaveisMercadoVale = [];
    let comprasReaisContagem = 0, totalMercadoDeCompras = 0, totalMercadoDeVariaveis = 0;

    function atualizarCardMercado() {
      totalMercado = totalMercadoDeCompras + totalMercadoDeVariaveis;
      if (categoriaFiltro === 'todas' && pessoaFiltro === 'todos') categoriaTotais['Mercado'] = totalMercado;
      else if (categoriaFiltro !== 'todas' && categoriaFiltro !== 'Mercado') categoriaTotais['Mercado'] = 0;

      document.getElementById('card-mercado').innerHTML = `
        <div class="ledger-figure"><div class="value">${formatBRL(totalMercado)}</div><div class="label">${comprasReaisContagem} ida(s) ao mercado + ${formatBRL(totalMercadoDeVariaveis)} lançado direto em Variáveis</div></div>
      `;
    }

    const u1 = onSnapshot(query(collection(db, 'mercadoCompras')), (snap) => {
      todasComprasMercado = snap.docs.map(d => d.data());
      const comprasMes = todasComprasMercado.filter(c => monthRefFromDate(c.data) === mes);

      // Soma só a parte de cada compra que NÃO foi paga no vale (compras podem ter pagamento dividido).
      totalMercadoDeCompras = comprasMes.reduce((s, c) => s + valorNaoValeDaCompra(c), 0);
      comprasReaisContagem = comprasMes.filter(c => valorNaoValeDaCompra(c) > 0).length;

      atualizarCardMercado();
      atualizarCardVale();
      atualizarResumo(); atualizarCategorias();
    });
    cachedUnsubs.push(u1);

    let todosValeConfigs = [];
    const u1b = onSnapshot(query(collection(db, 'valeAlimentacaoConfig')), (snap) => {
      todosValeConfigs = snap.docs.map(d => d.data());
      atualizarCardVale();
    });
    cachedUnsubs.push(u1b);

    function figuraVale(tipo) {
      const r = calcularValeAcumulado(tipo, mes, todosValeConfigs, todasComprasMercado, todasDespesasVariaveisMercadoVale);
      const percentual = r.saldoDisponivel > 0 ? Math.min(100, (r.gastoMes / r.saldoDisponivel) * 100) : 0;
      return `
        <div>
          <div style="color:var(--text-dim); font-size:12px; text-transform:uppercase; margin-bottom:6px">${tipo === 'livre' ? 'Livre' : 'Voucher'}</div>
          <div class="grid grid-2">
            <div class="ledger-figure"><div class="value">${formatBRL(r.gastoMes)}</div><div class="label">Despesa no mês</div></div>
            <div class="ledger-figure"><div class="value" style="color:${r.saldoRestante >= 0 ? 'var(--olive)' : 'var(--terracota)'}">${formatBRL(r.saldoRestante)}</div><div class="label">Restante</div></div>
          </div>
          <div style="margin-top:8px; background:var(--surface-2); border-radius:6px; height:8px; overflow:hidden">
            <div style="width:${percentual}%; height:100%; background:${percentual >= 90 ? 'var(--terracota)' : 'var(--blue-strong)'}"></div>
          </div>
        </div>
      `;
    }

    function atualizarCardVale() {
      document.getElementById('card-vale').innerHTML = `
        <div class="grid grid-2">
          ${figuraVale('livre')}
          ${figuraVale('voucher')}
        </div>
        <p style="color:var(--text-dim); font-size:13px; margin-top:12px">Não entra no "Total de despesas do mês" do casal — é um benefício à parte. O saldo que sobra acumula pro mês seguinte.</p>
      `;
    }

    // Cartão: separa lançamentos manuais (não duplicar mercado/variaveis) e monta faturas do mês
    let unsubCartaoRec = null;
    let unsubFaturaStatus = null;
    const u2 = onSnapshot(query(collection(db, 'cartoes')), (snapCartoes) => {
      const cartoes = snapCartoes.docs.map(d => ({ id: d.id, ...d.data() }));
      const u2b = onSnapshot(query(collection(db, 'cartaoLancamentos')), (snap) => {
        const lancs = snap.docs.map(d => d.data());
        const totalPorCartao = {};
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
              totalPorCartao[l.cartaoId] = (totalPorCartao[l.cartaoId] || 0) + valorParcela;
              if (l.origem === 'manual' && (categoriaFiltro === 'todas' || categoriaFiltro === l.categoria)) {
                catManual[l.categoria] = (catManual[l.categoria] || 0) + valorParcela;
              }
            }
          }
        });

        if (unsubCartaoRec) unsubCartaoRec();
        unsubCartaoRec = onSnapshot(query(collection(db, 'cartaoRecorrentes')), (snapRec) => {
          const recorrentes = snapRec.docs.map(d => d.data());
          recorrentes.forEach(r => {
            const cartao = cartoes.find(c => c.id === r.cartaoId);
            if (pessoaFiltro !== 'todos' && cartao && cartao.titular !== pessoaFiltro) return;
            if (r.mesInicio && r.mesInicio <= mes) {
              totalPorCartao[r.cartaoId] = (totalPorCartao[r.cartaoId] || 0) + r.valor;
              if (categoriaFiltro === 'todas' || categoriaFiltro === r.categoria) {
                categoriaTotais[r.categoria] = (categoriaTotais[r.categoria] || 0) + r.valor;
              }
            }
          });
          Object.keys(catManual).forEach(cat => { categoriaTotais[cat] = (categoriaTotais[cat] || 0) + catManual[cat]; });

          if (unsubFaturaStatus) unsubFaturaStatus();
          unsubFaturaStatus = onSnapshot(query(collection(db, 'faturaStatus')), (snapStatus) => {
            const statusDoMes = snapStatus.docs.map(d => d.data()).filter(s => s.mes === mes);
            let totalPago = 0, totalPendente = 0;
            Object.entries(totalPorCartao).forEach(([cartaoId, valor]) => {
              const pago = statusDoMes.some(s => s.cartaoId === cartaoId);
              if (pago) totalPago += valor; else totalPendente += valor;
            });
            totalCartaoManual = totalPago;
            totalCartaoCompetenciaMes = totalPendente;

            document.getElementById('card-cartao').innerHTML = `
              <div class="ledger-figure"><div class="value">${formatBRL(totalPago + totalPendente)}</div><div class="label">Total das faturas este mês</div></div>
              <p style="color:var(--text-dim); font-size:13px; margin-top:10px">${formatBRL(totalPago)} já pago(s) · ${formatBRL(totalPendente)} em aberto</p>
            `;
            atualizarResumo(); atualizarCategorias();
          });
        });
      });
      cachedUnsubs.push(u2b);
    });
    cachedUnsubs.push(u2);
    cachedUnsubs.push(() => { if (unsubCartaoRec) unsubCartaoRec(); });
    cachedUnsubs.push(() => { if (unsubFaturaStatus) unsubFaturaStatus(); });

    // Variáveis
    const u3 = onSnapshot(query(collection(db, 'variaveisDespesas')), (snap) => {
      const todasDespesas = snap.docs.map(d => d.data());
      // Vale gasto em Mercado lançado por Variáveis também entra no acúmulo do Vale Alimentação (todos os meses, não só o filtrado).
      // Passa todas as despesas de Mercado (não só as com formaPagamento==='vale'): despesas com pagamento dividido
      // podem ter só uma parte no vale, e valorValeDaCompra sabe extrair essa parte de qualquer formato.
      todasDespesasVariaveisMercadoVale = todasDespesas.filter(v => v.categoria === 'Mercado');

      let despesas = todasDespesas.filter(v => monthRefFromDate(v.data) === mes);
      if (pessoaFiltro !== 'todos') despesas = despesas.filter(v => v.pessoa === pessoaFiltro || v.pessoa === 'Casal');
      if (categoriaFiltro !== 'todas') despesas = despesas.filter(v => v.categoria === categoriaFiltro);

      // Mercado lançado em Variáveis (sem controle de itens) conta junto com o Mercado detalhado, independente
      // de qual forma de pagamento — igual ao Mercado com itens: só exclui a parte paga no vale (não é caixa do casal).
      const mercadoDespesas = despesas.filter(v => v.categoria === 'Mercado');
      const outrasDespesas = despesas.filter(v => v.categoria !== 'Mercado');

      totalMercadoDeVariaveis = mercadoDespesas.reduce((s, v) => s + valorNaoValeDaCompra(v), 0);
      totalVariaveis = outrasDespesas.reduce((s, v) => s + v.valorTotal, 0);
      despesas.forEach(v => { categoriaTotais[v.categoria] = (categoriaTotais[v.categoria] || 0) + v.valorTotal; });

      atualizarCardMercado();
      atualizarCardVale();
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
          return !st || (st.status !== 'pago' && st.status !== 'ignorado');
        });
        totalFixasPendentes = pendentes.reduce((s, t) => s + (t.valor || 0), 0);
        renderAlertas(pendentes);
        atualizarResumo();
      });
      cachedUnsubs.push(u4b);
    });
    cachedUnsubs.push(u4);

    // Receitas recorrentes (base da projeção financeira e do saldo previsto)
    let receitasRecTemplates = [];
    const u8 = onSnapshot(query(collection(db, 'receitasRecorrentes')), (snap) => {
      receitasRecTemplates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      totalReceitasRecorrentes = receitasRecTemplates.reduce((s, r) => s + (r.valor || 0), 0);
      atualizarResumo();
    });
    cachedUnsubs.push(u8);

    const u8b = onSnapshot(query(collection(db, 'receitasRecorrentesStatus')), (snap) => {
      const statusDoMes = snap.docs.map(d => d.data()).filter(s => s.mes === mes);
      totalReceitasRecorrentesPendentes = receitasRecTemplates.reduce((s, r) => {
        const recebida = statusDoMes.some(st => st.receitaId === r.id);
        return recebida ? s : s + (r.valor || 0);
      }, 0);
      atualizarResumo();
    });
    cachedUnsubs.push(u8b);

    // Entradas previstas (marcadas como "previsto", ainda não efetivadas) do mês selecionado
    const u8c = onSnapshot(query(collection(db, 'entradas')), (snap) => {
      totalEntradasPrevistasNaoEfetivadas = snap.docs
        .map(d => d.data())
        .filter(e => e.previsto && e.efetivada === false && monthRefFromDate(e.data) === mes)
        .reduce((s, e) => s + (e.valor || 0), 0);
      atualizarResumo();
    });
    cachedUnsubs.push(u8c);

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
