import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, formatDate, todayISO, monthRefFromDate, currentMonthRef,
  addMonths, calcularMesFatura, monthPickerHTML, wireMonthPicker, formatCartao, CATEGORIAS_GASTO,
  collapsibleHeaderHTML, wireCollapsible
} from '../helpers.js';

const cartoesCol = collection(db, 'cartoes');
const lancamentosCol = collection(db, 'cartaoLancamentos');
const mercadoComprasCol = collection(db, 'mercadoCompras');
const valeConfigCol = collection(db, 'valeAlimentacaoConfig');

export async function getCartoes() {
  return new Promise((resolve) => {
    const unsub = onSnapshot(cartoesCol, (snap) => {
      resolve(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      unsub();
    });
  });
}

// Espelha um gasto de outro módulo (Mercado, Variáveis) dentro do Cartão,
// evitando duplicidade de lançamento manual.
export async function upsertLancamentoEspelho({ origem, origemId, cartaoId, valorTotal, parcelado, numParcelas, data, descricao, categoria }) {
  const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
  const existing = snap.docs.find(d => d.data().origem === origem && d.data().origemId === origemId);
  const payload = {
    cartaoId, descricao, categoria, valorTotal,
    parcelado: !!parcelado,
    numParcelas: parcelado ? numParcelas : 1,
    data, origem, origemId
  };
  if (existing) {
    await updateDoc(doc(db, 'cartaoLancamentos', existing.id), payload);
  } else {
    await addDoc(lancamentosCol, payload);
  }
}

export async function removerLancamentoEspelho(origem, origemId) {
  const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
  const existing = snap.docs.find(d => d.data().origem === origem && d.data().origemId === origemId);
  if (existing) await deleteDoc(doc(db, 'cartaoLancamentos', existing.id));
}

// Retorna as parcelas de um lançamento já distribuídas por mês de competência (fatura),
// considerando o fechamento/vencimento do cartão (não a data da compra).
function parcelasPorCompetencia(lancamento, cartao) {
  const parcelas = lancamento.parcelado ? lancamento.numParcelas : 1;
  const valorParcela = lancamento.valorTotal / parcelas;
  const mesBase = calcularMesFatura(lancamento.data, cartao?.diaFechamento, cartao?.diaVencimento);
  const resultado = [];
  for (let p = 0; p < parcelas; p++) {
    resultado.push({ mes: addMonths(mesBase, p), numero: p + 1, totalParcelas: parcelas, valor: valorParcela });
  }
  return resultado;
}

// ==================== SUBMÓDULO: CARTÕES (com visão detalhada) ====================
export function renderCartaoCartoes(container) {
  const unsubs = [];
  let mes = currentMonthRef();
  let expandido = null;

  container.innerHTML = `
    <h2 class="module-title">Cartão · Cartões cadastrados</h2>
    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-cartao-body', 'Novo cartão')}
      <div id="form-cartao-body" class="collapsible-body collapsed">
        <div class="grid grid-4" style="margin-top:12px">
          <div><label>Apelido</label><input type="text" id="c-apelido" placeholder="Ex: Nubank PF"></div>
          <div><label>Titular</label>
            <select id="c-titular"><option>Natasha</option><option>Daniel</option></select>
          </div>
          <div><label>Dia fechamento</label><input type="number" id="c-fechamento" min="1" max="31"></div>
          <div><label>Dia vencimento</label><input type="number" id="c-vencimento" min="1" max="31"></div>
          <div><label>Limite</label><input type="number" step="0.01" id="c-limite" placeholder="0,00"></div>
        </div>
        <button class="btn" id="btn-add-cartao">Adicionar cartão</button>
      </div>
    </div>
    <div id="mp-slot-cartoes">${monthPickerHTML(mes)}</div>
    <div id="lista-cartoes"></div>
  `;
  wireCollapsible(container);

  function refreshMonthPicker() {
    document.getElementById('mp-slot-cartoes').innerHTML = monthPickerHTML(mes);
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; refreshMonthPicker(); renderLista(); });
  }
  refreshMonthPicker();

  document.getElementById('btn-add-cartao').addEventListener('click', async () => {
    const apelido = document.getElementById('c-apelido').value;
    if (!apelido) return;
    await addDoc(cartoesCol, {
      apelido,
      titular: document.getElementById('c-titular').value,
      diaFechamento: parseInt(document.getElementById('c-fechamento').value) || null,
      diaVencimento: parseInt(document.getElementById('c-vencimento').value) || null,
      limite: parseFloat(document.getElementById('c-limite').value) || null
    });
    document.getElementById('c-apelido').value = '';
    document.getElementById('c-limite').value = '';
  });

  let cartoesAtuais = [];
  let lancamentosAtuais = [];

  function renderLista() {
    const el = document.getElementById('lista-cartoes');
    if (!cartoesAtuais.length) {
      el.innerHTML = '<div class="empty-state">Nenhum cartão cadastrado ainda.</div>';
      return;
    }
    el.innerHTML = cartoesAtuais.map(c => {
      const lancsDoCartao = lancamentosAtuais.filter(l => l.cartaoId === c.id);
      let totalFatura = 0;
      const detalhes = [];
      lancsDoCartao.forEach(l => {
        parcelasPorCompetencia(l, c).forEach(p => {
          if (p.mes === mes) {
            totalFatura += p.valor;
            detalhes.push({ ...l, valorParcela: p.valor, numero: p.numero, totalParcelas: p.totalParcelas });
          }
        });
      });
      const percentual = c.limite ? Math.min(100, (totalFatura / c.limite) * 100) : null;
      const aberto = expandido === c.id;

      return `
        <div class="card" style="margin-bottom:16px">
          <div style="display:flex; justify-content:space-between; align-items:center; cursor:pointer" data-toggle-cartao="${c.id}">
            <div>
              <h3 style="margin-bottom:2px">${formatCartao(c)}</h3>
              <span class="tag">fecha dia ${c.diaFechamento || '-'} · vence dia ${c.diaVencimento || '-'}</span>
            </div>
            <div style="text-align:right">
              <div class="display" style="color:var(--gold); font-size:20px">${formatBRL(totalFatura)}</div>
              <span style="color:var(--text-dim); font-size:12px">fatura de ${mes}</span>
            </div>
          </div>

          ${aberto ? `
            <div style="margin-top:16px; border-top:1px solid var(--border); padding-top:16px">
              <div class="grid grid-3" style="margin-bottom:16px">
                <div class="ledger-figure"><div class="value">${c.limite ? formatBRL(c.limite) : '-'}</div><div class="label">Limite</div></div>
                <div class="ledger-figure"><div class="value">${formatBRL(totalFatura)}</div><div class="label">Gasto na fatura</div></div>
                <div class="ledger-figure"><div class="value">${percentual !== null ? percentual.toFixed(0) + '%' : '-'}</div><div class="label">Do limite usado</div></div>
              </div>
              ${percentual !== null ? `
                <div style="background:var(--surface-2); border-radius:6px; height:10px; overflow:hidden; margin-bottom:16px">
                  <div style="width:${percentual}%; height:100%; background:${percentual >= 90 ? 'var(--terracota)' : 'var(--gold)'}"></div>
                </div>
              ` : ''}
              ${detalhes.length ? `
                <table>
                  <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Parcela</th><th>Valor</th></tr></thead>
                  <tbody>
                    ${detalhes.sort((a, b) => (a.data || '').localeCompare(b.data || '')).map(d => `
                      <tr>
                        <td>${formatDate(d.data)}</td>
                        <td>${d.descricao}</td>
                        <td><span class="tag">${d.categoria}</span></td>
                        <td>${d.parcelado ? d.numero + '/' + d.totalParcelas : '-'}</td>
                        <td>${formatBRL(d.valorParcela)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : '<div class="empty-state">Nenhum lançamento nessa fatura.</div>'}
              <div style="margin-top:12px; text-align:right">
                <button class="btn-danger" data-del-cartao="${c.id}">Remover cartão</button>
              </div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    el.querySelectorAll('[data-toggle-cartao]').forEach(elDiv => {
      elDiv.addEventListener('click', () => {
        expandido = expandido === elDiv.dataset.toggleCartao ? null : elDiv.dataset.toggleCartao;
        renderLista();
      });
    });
    el.querySelectorAll('[data-del-cartao]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Remover cartão?')) await deleteDoc(doc(db, 'cartoes', btn.dataset.delCartao));
      });
    });
  }

  const unsub1 = onSnapshot(cartoesCol, (snap) => {
    cartoesAtuais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLista();
  });
  unsubs.push(unsub1);

  const unsub2 = onSnapshot(query(lancamentosCol), (snap) => {
    lancamentosAtuais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLista();
  });
  unsubs.push(unsub2);

  return unsubs;
}

// ==================== SUBMÓDULO: VALE ALIMENTAÇÃO ====================
export function renderCartaoVale(container) {
  const unsubs = [];
  let mes = currentMonthRef();

  async function render() {
    container.innerHTML = `
      <h2 class="module-title">Cartão · Vale Alimentação</h2>
      ${monthPickerHTML(mes)}
      <div class="card" style="margin-bottom:24px">
        <h3>Vale Alimentação (Natasha)</h3>
        <p style="color:var(--text-dim); font-size:13px; margin-top:0">O vale do Daniel não é controlado aqui — só o seu, pra acompanhar as idas ao mercado.</p>
        <div class="grid grid-2" style="margin-top:12px; max-width:500px">
          <div>
            <label>Valor recebido no mês</label>
            <input type="number" step="0.01" id="vale-valor-mensal">
          </div>
        </div>
        <button class="btn" id="btn-salvar-vale">Salvar valor do mês</button>
      </div>
      <div class="card">
        <h3>Consumo do mês</h3>
        <div id="vale-resumo" style="margin-top:16px"></div>
      </div>
    `;
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; render(); });

    const snapConfig = await new Promise(res => { const u = onSnapshot(query(valeConfigCol), s => { res(s); u(); }); });
    const configExistente = snapConfig.docs.find(d => d.data().mes === mes);
    if (configExistente) document.getElementById('vale-valor-mensal').value = configExistente.data().valorMensal;

    document.getElementById('btn-salvar-vale').addEventListener('click', async () => {
      const valorMensal = parseFloat(document.getElementById('vale-valor-mensal').value) || 0;
      if (configExistente) {
        await updateDoc(doc(db, 'valeAlimentacaoConfig', configExistente.id), { valorMensal });
      } else {
        await addDoc(valeConfigCol, { mes, valorMensal });
      }
      render();
    });

    const unsub = onSnapshot(query(mercadoComprasCol), (snap) => {
      const compras = snap.docs.map(d => d.data());
      const usadasVale = compras.filter(c => c.formaPagamento === 'vale' && c.valeTitular === 'Natasha' && monthRefFromDate(c.data) === mes);
      const totalUsado = usadasVale.reduce((s, c) => s + (c.valorTotal || 0), 0);
      const valorMensal = configExistente ? configExistente.data().valorMensal : 0;
      const percentual = valorMensal > 0 ? Math.min(100, (totalUsado / valorMensal) * 100) : 0;
      const restante = valorMensal - totalUsado;
      document.getElementById('vale-resumo').innerHTML = `
        <div class="grid grid-3">
          <div class="ledger-figure"><div class="value">${formatBRL(totalUsado)}</div><div class="label">Usado no mês</div></div>
          <div class="ledger-figure"><div class="value">${percentual.toFixed(0)}%</div><div class="label">Do total disponível</div></div>
          <div class="ledger-figure"><div class="value" style="color:${restante >= 0 ? 'var(--olive)' : 'var(--terracota)'}">${formatBRL(restante)}</div><div class="label">Saldo restante</div></div>
        </div>
        <div style="margin-top:16px; background:var(--surface-2); border-radius:6px; height:10px; overflow:hidden">
          <div style="width:${percentual}%; height:100%; background:${percentual >= 90 ? 'var(--terracota)' : 'var(--gold)'}"></div>
        </div>
        <p style="color:var(--text-dim); font-size:13px; margin-top:16px">${usadasVale.length} compra(s) de mercado paga(s) com o vale nesse mês.</p>
      `;
    });
    unsubs.push(unsub);
  }

  render();
  return unsubs;
}

// ==================== SUBMÓDULO: LANÇAMENTOS ====================
export function renderCartaoLancamentos(container) {
  const unsubs = [];
  let mes = currentMonthRef();
  let filtroCategoria = 'todas';

  async function render() {
    const cartoes = await getCartoes();
    container.innerHTML = `
      <h2 class="module-title">Cartão · Lançamentos</h2>
      ${monthPickerHTML(mes)}
      <div class="card" style="margin-bottom:24px">
        ${collapsibleHeaderHTML('form-lanc-body', 'Novo lançamento manual')}
        <div id="form-lanc-body" class="collapsible-body collapsed">
          <p style="color:var(--text-dim); font-size:13px">Lançamentos de Mercado e Variáveis entram automaticamente aqui — não precisam ser adicionados manualmente.</p>
          <div class="grid grid-3" style="margin-top:12px">
            <div><label>Cartão</label>
              <select id="l-cartao">${cartoes.map(c => `<option value="${c.id}">${formatCartao(c)}</option>`).join('')}</select>
            </div>
            <div><label>Descrição</label><input type="text" id="l-descricao"></div>
            <div><label>Categoria</label>
              <select id="l-categoria">${CATEGORIAS_GASTO.map(c => `<option>${c}</option>`).join('')}</select>
            </div>
            <div><label>Valor total</label><input type="number" step="0.01" id="l-valor"></div>
            <div><label>Data da compra</label><input type="date" id="l-data" value="${todayISO()}"></div>
            <div><label>Parcelado?</label>
              <select id="l-parcelado"><option value="nao">Não</option><option value="sim">Sim</option></select>
            </div>
            <div id="l-parcelas-wrap" class="conditional"><label>Número de parcelas</label><input type="number" id="l-parcelas" min="2"></div>
          </div>
          <button class="btn" id="btn-add-lancamento">Adicionar lançamento</button>
        </div>
      </div>
      <div class="filters-bar">
        <select id="filtro-categoria">
          <option value="todas">Todas as categorias</option>
          ${CATEGORIAS_GASTO.map(c => `<option value="${c}" ${filtroCategoria === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <p style="color:var(--text-dim); font-size:13px">Mostrando pela <strong>fatura de competência</strong> (mês de vencimento), não pela data da compra.</p>
      <div id="lista-lancamentos"></div>
    `;
    wireCollapsible(container);
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; render(); });

    document.getElementById('filtro-categoria').addEventListener('change', (e) => {
      filtroCategoria = e.target.value;
      render();
    });

    document.getElementById('l-parcelado').addEventListener('change', (e) => {
      document.getElementById('l-parcelas-wrap').classList.toggle('show', e.target.value === 'sim');
    });
    document.getElementById('btn-add-lancamento').addEventListener('click', async () => {
      const parcelado = document.getElementById('l-parcelado').value === 'sim';
      await addDoc(lancamentosCol, {
        cartaoId: document.getElementById('l-cartao').value,
        descricao: document.getElementById('l-descricao').value || 'Sem descrição',
        categoria: document.getElementById('l-categoria').value,
        valorTotal: parseFloat(document.getElementById('l-valor').value) || 0,
        parcelado,
        numParcelas: parcelado ? (parseInt(document.getElementById('l-parcelas').value) || 1) : 1,
        data: document.getElementById('l-data').value,
        origem: 'manual'
      });
      render();
    });

    const unsub = onSnapshot(query(lancamentosCol), (snap) => {
      const todosLancs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      let linhas = [];
      todosLancs.forEach(l => {
        const cartao = cartoes.find(c => c.id === l.cartaoId);
        parcelasPorCompetencia(l, cartao).forEach(p => {
          if (p.mes === mes) linhas.push({ ...l, cartao, valorParcela: p.valor, numero: p.numero, totalParcelas: p.totalParcelas });
        });
      });
      if (filtroCategoria !== 'todas') linhas = linhas.filter(l => l.categoria === filtroCategoria);
      linhas.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

      const el = document.getElementById('lista-lancamentos');
      if (!linhas.length) {
        el.innerHTML = '<div class="empty-state">Nenhum lançamento nessa fatura.</div>';
        return;
      }
      el.innerHTML = `
        <table>
          <thead><tr><th>Data compra</th><th>Cartão</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Parcela</th><th>Origem</th><th></th></tr></thead>
          <tbody>
            ${linhas.map(l => `<tr>
                <td>${formatDate(l.data)}</td>
                <td>${l.cartao ? formatCartao(l.cartao) : '-'}</td>
                <td>${l.descricao}</td>
                <td><span class="tag">${l.categoria}</span></td>
                <td>${formatBRL(l.valorParcela)}</td>
                <td>${l.parcelado ? l.numero + '/' + l.totalParcelas : '-'}</td>
                <td>${l.origem === 'manual' ? 'Manual' : `<span class="tag">${l.origem === 'mercado' ? 'Mercado (auto)' : 'Variáveis (auto)'}</span>`}</td>
                <td>${l.origem === 'manual' ? `<button class="btn-danger" data-del="${l.id}">Remover</button>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
      el.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Remover lançamento?')) await deleteDoc(doc(db, 'cartaoLancamentos', btn.dataset.del));
        });
      });
    });
    unsubs.push(unsub);
  }

  render();
  return unsubs;
}

// ==================== SUBMÓDULO: FATURAS FUTURAS ====================
export function renderCartaoFaturas(container) {
  const unsubs = [];
  container.innerHTML = `<h2 class="module-title">Cartão · Faturas futuras</h2><div id="faturas-content"></div>`;

  async function render() {
    const cartoes = await getCartoes();
    const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
    const lancs = snap.docs.map(d => d.data());

    const meses = [];
    const hoje = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
      meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const totalPorMes = {};
    meses.forEach(m => totalPorMes[m] = 0);

    lancs.forEach(l => {
      const cartao = cartoes.find(c => c.id === l.cartaoId);
      parcelasPorCompetencia(l, cartao).forEach(p => {
        if (totalPorMes[p.mes] !== undefined) totalPorMes[p.mes] += p.valor;
      });
    });

    document.getElementById('faturas-content').innerHTML = `
      <div class="card">
        <h3>Comprometimento futuro (todos os cartões, por fatura de vencimento)</h3>
        <div class="grid grid-3" style="margin-top:16px">
          ${meses.map(m => `
            <div class="ledger-figure">
              <div class="value">${formatBRL(totalPorMes[m])}</div>
              <div class="label">${m}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  render();
  return unsubs;
}

export { parcelasPorCompetencia };
