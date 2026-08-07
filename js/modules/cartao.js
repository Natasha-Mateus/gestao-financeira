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
        <div style="display:flex; gap:8px">
          <button class="btn-ghost" id="btn-cancelar-cartao" style="display:none">Cancelar edição</button>
          <button class="btn" id="btn-add-cartao">Adicionar cartão</button>
        </div>
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

  let editandoCartaoId = null;
  function resetFormCartao() {
    editandoCartaoId = null;
    document.getElementById('btn-cancelar-cartao').style.display = 'none';
    document.getElementById('btn-add-cartao').textContent = 'Adicionar cartão';
    document.getElementById('c-apelido').value = '';
    document.getElementById('c-titular').value = 'Natasha';
    document.getElementById('c-fechamento').value = '';
    document.getElementById('c-vencimento').value = '';
    document.getElementById('c-limite').value = '';
  }
  document.getElementById('btn-cancelar-cartao').addEventListener('click', resetFormCartao);

  document.getElementById('btn-add-cartao').addEventListener('click', async () => {
    const apelido = document.getElementById('c-apelido').value;
    if (!apelido) return;
    const payload = {
      apelido,
      titular: document.getElementById('c-titular').value,
      diaFechamento: parseInt(document.getElementById('c-fechamento').value) || null,
      diaVencimento: parseInt(document.getElementById('c-vencimento').value) || null,
      limite: parseFloat(document.getElementById('c-limite').value) || null
    };
    if (editandoCartaoId) {
      await updateDoc(doc(db, 'cartoes', editandoCartaoId), payload);
    } else {
      await addDoc(cartoesCol, payload);
    }
    resetFormCartao();
  });

  let cartoesAtuais = [];
  let lancamentosAtuais = [];
  let recorrentesAtuais = [];

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
      recorrentesAtuais.filter(r => r.cartaoId === c.id && r.mesInicio && r.mesInicio <= mes).forEach(r => {
        totalFatura += r.valor;
        detalhes.push({ descricao: r.descricao, categoria: r.categoria, valorParcela: r.valor, parcelado: false, origem: 'recorrente', data: null });
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
              <div class="grid grid-4" style="margin-bottom:16px">
                <div class="ledger-figure"><div class="value">${c.limite ? formatBRL(c.limite) : '-'}</div><div class="label">Limite</div></div>
                <div class="ledger-figure"><div class="value">${formatBRL(totalFatura)}</div><div class="label">Gasto na fatura</div></div>
                <div class="ledger-figure"><div class="value" style="color:var(--olive)">${c.limite ? formatBRL(Math.max(0, c.limite - totalFatura)) : '-'}</div><div class="label">Limite disponível</div></div>
                <div class="ledger-figure"><div class="value">${percentual !== null ? percentual.toFixed(0) + '%' : '-'}</div><div class="label">Do limite usado</div></div>
              </div>
              ${percentual !== null ? `
                <div style="background:var(--surface-2); border-radius:6px; height:10px; overflow:hidden; margin-bottom:16px">
                  <div style="width:${percentual}%; height:100%; background:${percentual >= 90 ? 'var(--terracota)' : 'var(--blue-strong)'}"></div>
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
                <button class="btn-ghost" data-editar-cartao="${c.id}">Editar cartão</button>
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
    el.querySelectorAll('[data-editar-cartao]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = cartoesAtuais.find(x => x.id === btn.dataset.editarCartao);
        editandoCartaoId = c.id;
        document.getElementById('form-cartao-body').classList.remove('collapsed');
        document.getElementById('btn-cancelar-cartao').style.display = 'inline-block';
        document.getElementById('btn-add-cartao').textContent = 'Atualizar cartão';
        document.getElementById('c-apelido').value = c.apelido;
        document.getElementById('c-titular').value = c.titular;
        document.getElementById('c-fechamento').value = c.diaFechamento || '';
        document.getElementById('c-vencimento').value = c.diaVencimento || '';
        document.getElementById('c-limite').value = c.limite || '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
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

  const unsub3 = onSnapshot(query(recorrentesCol), (snap) => {
    recorrentesAtuais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLista();
  });
  unsubs.push(unsub3);

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
      <p style="color:var(--text-dim); font-size:13px">O vale do Daniel não é controlado aqui — só o seu, pra acompanhar as idas ao mercado. Como é um cartão flex, os saldos Livre e Voucher são acompanhados separadamente.</p>

      <div class="card" style="margin-bottom:24px">
        <h3>Entrada deste mês</h3>
        <p style="color:var(--text-dim); font-size:13px; margin-top:0">Some ao saldo que sobrou do mês anterior — não substitui.</p>
        <div class="grid grid-2" style="margin-top:12px; max-width:500px">
          <div><label>Entrada Livre</label><input type="number" step="0.01" id="vale-valor-livre"></div>
          <div><label>Entrada Voucher</label><input type="number" step="0.01" id="vale-valor-voucher"></div>
        </div>
        <button class="btn" id="btn-salvar-vale">Salvar valores do mês</button>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>Livre</h3>
          <div id="vale-resumo-livre" style="margin-top:16px"></div>
        </div>
        <div class="card">
          <h3>Voucher</h3>
          <div id="vale-resumo-voucher" style="margin-top:16px"></div>
        </div>
      </div>
    `;
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; render(); });

    const snapConfig = await new Promise(res => { const u = onSnapshot(query(valeConfigCol), s => { res(s); u(); }); });
    const configs = snapConfig.docs.map(d => d.data());
    const configExistente = configs.find(c => c.mes === mes);
    if (configExistente) {
      document.getElementById('vale-valor-livre').value = configExistente.valorMensalLivre || '';
      document.getElementById('vale-valor-voucher').value = configExistente.valorMensalVoucher || '';
    }

    document.getElementById('btn-salvar-vale').addEventListener('click', async () => {
      const valorMensalLivre = parseFloat(document.getElementById('vale-valor-livre').value) || 0;
      const valorMensalVoucher = parseFloat(document.getElementById('vale-valor-voucher').value) || 0;
      const docExistente = snapConfig.docs.find(d => d.data().mes === mes);
      if (docExistente) {
        await updateDoc(doc(db, 'valeAlimentacaoConfig', docExistente.id), { valorMensalLivre, valorMensalVoucher });
      } else {
        await addDoc(valeConfigCol, { mes, valorMensalLivre, valorMensalVoucher });
      }
      render();
    });

    function renderTipo(elId, tipo, compras) {
      const r = calcularValeAcumulado(tipo, mes, configs, compras);
      const percentual = r.saldoDisponivel > 0 ? Math.min(100, (r.gastoMes / r.saldoDisponivel) * 100) : 0;
      document.getElementById(elId).innerHTML = `
        <div class="grid grid-2">
          <div class="ledger-figure"><div class="value">${formatBRL(r.saldoDisponivel)}</div><div class="label">Disponível no mês (restante anterior + entrada)</div></div>
          <div class="ledger-figure"><div class="value">${formatBRL(r.gastoMes)}</div><div class="label">Usado no mês</div></div>
        </div>
        <div class="ledger-figure" style="margin-top:8px"><div class="value" style="color:${r.saldoRestante >= 0 ? 'var(--olive)' : 'var(--terracota)'}">${formatBRL(r.saldoRestante)}</div><div class="label">Saldo restante (vai pro mês seguinte)</div></div>
        <div style="margin-top:12px; background:var(--surface-2); border-radius:6px; height:8px; overflow:hidden">
          <div style="width:${percentual}%; height:100%; background:${percentual >= 90 ? 'var(--terracota)' : 'var(--blue-strong)'}"></div>
        </div>
      `;
    }

    const unsub = onSnapshot(query(mercadoComprasCol), (snap) => {
      const compras = snap.docs.map(d => d.data());
      renderTipo('vale-resumo-livre', 'livre', compras);
      renderTipo('vale-resumo-voucher', 'voucher', compras);
    });
    unsubs.push(unsub);
  }

  render();
  return unsubs;
}

// ==================== SUBMÓDULO: LANÇAMENTOS ====================
const recorrentesCol = collection(db, 'cartaoRecorrentes');

export function renderCartaoLancamentos(container) {
  const unsubs = [];
  let mes = currentMonthRef();
  let filtroCategoria = 'todas';
  let editandoLancId = null;
  let editandoRecId = null;

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
          <div style="display:flex; gap:8px">
            <button class="btn-ghost" id="btn-cancelar-lanc" style="display:none">Cancelar edição</button>
            <button class="btn" id="btn-add-lancamento">Adicionar lançamento</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:24px">
        ${collapsibleHeaderHTML('form-rec-body', 'Recorrências (plano de celular, assinaturas, etc.)')}
        <div id="form-rec-body" class="collapsible-body collapsed">
          <p style="color:var(--text-dim); font-size:13px">Uma vez cadastrada, a recorrência aparece automaticamente em todas as faturas a partir do mês de início — não precisa relançar todo mês.</p>
          <div class="grid grid-4" style="margin-top:12px">
            <div><label>Cartão</label>
              <select id="r-cartao">${cartoes.map(c => `<option value="${c.id}">${formatCartao(c)}</option>`).join('')}</select>
            </div>
            <div><label>Descrição</label><input type="text" id="r-descricao" placeholder="Ex: Plano de celular"></div>
            <div><label>Categoria</label>
              <select id="r-categoria">${CATEGORIAS_GASTO.map(c => `<option>${c}</option>`).join('')}</select>
            </div>
            <div><label>Valor mensal</label><input type="number" step="0.01" id="r-valor"></div>
            <div><label>Mês de início</label><input type="month" id="r-mes-inicio" value="${mes}"></div>
          </div>
          <div style="display:flex; gap:8px">
            <button class="btn-ghost" id="btn-cancelar-rec" style="display:none">Cancelar edição</button>
            <button class="btn" id="btn-add-rec">Adicionar recorrência</button>
          </div>
          <div id="lista-recorrentes" style="margin-top:20px"></div>
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

    // ---- Lançamento manual ----
    function resetFormLanc() {
      editandoLancId = null;
      document.getElementById('btn-cancelar-lanc').style.display = 'none';
      document.getElementById('btn-add-lancamento').textContent = 'Adicionar lançamento';
      document.getElementById('l-descricao').value = '';
      document.getElementById('l-valor').value = '';
      document.getElementById('l-data').value = todayISO();
    }
    document.getElementById('btn-cancelar-lanc').addEventListener('click', resetFormLanc);

    document.getElementById('l-parcelado').addEventListener('change', (e) => {
      document.getElementById('l-parcelas-wrap').classList.toggle('show', e.target.value === 'sim');
    });
    document.getElementById('btn-add-lancamento').addEventListener('click', async () => {
      const parcelado = document.getElementById('l-parcelado').value === 'sim';
      const payload = {
        cartaoId: document.getElementById('l-cartao').value,
        descricao: document.getElementById('l-descricao').value || 'Sem descrição',
        categoria: document.getElementById('l-categoria').value,
        valorTotal: parseFloat(document.getElementById('l-valor').value) || 0,
        parcelado,
        numParcelas: parcelado ? (parseInt(document.getElementById('l-parcelas').value) || 1) : 1,
        data: document.getElementById('l-data').value,
        origem: 'manual'
      };
      if (editandoLancId) {
        await updateDoc(doc(db, 'cartaoLancamentos', editandoLancId), payload);
      } else {
        await addDoc(lancamentosCol, payload);
      }
      resetFormLanc();
    });

    // ---- Recorrências ----
    function resetFormRec() {
      editandoRecId = null;
      document.getElementById('btn-cancelar-rec').style.display = 'none';
      document.getElementById('btn-add-rec').textContent = 'Adicionar recorrência';
      document.getElementById('r-descricao').value = '';
      document.getElementById('r-valor').value = '';
      document.getElementById('r-mes-inicio').value = mes;
    }
    document.getElementById('btn-cancelar-rec').addEventListener('click', resetFormRec);

    document.getElementById('btn-add-rec').addEventListener('click', async () => {
      const descricao = document.getElementById('r-descricao').value;
      const valor = parseFloat(document.getElementById('r-valor').value) || 0;
      if (!descricao || !valor) { alert('Preencha descrição e valor.'); return; }
      const payload = {
        cartaoId: document.getElementById('r-cartao').value,
        descricao,
        categoria: document.getElementById('r-categoria').value,
        valor,
        mesInicio: document.getElementById('r-mes-inicio').value || mes
      };
      if (editandoRecId) {
        await updateDoc(doc(db, 'cartaoRecorrentes', editandoRecId), payload);
      } else {
        await addDoc(recorrentesCol, payload);
      }
      resetFormRec();
    });

    const unsubRec = onSnapshot(query(recorrentesCol), (snap) => {
      const recorrentes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const el = document.getElementById('lista-recorrentes');
      if (!recorrentes.length) {
        el.innerHTML = '<div class="empty-state">Nenhuma recorrência cadastrada ainda.</div>';
        return;
      }
      el.innerHTML = `
        <table>
          <thead><tr><th>Descrição</th><th>Cartão</th><th>Categoria</th><th>Valor mensal</th><th>Início</th><th></th></tr></thead>
          <tbody>
            ${recorrentes.map(r => {
              const cartao = cartoes.find(c => c.id === r.cartaoId);
              return `<tr>
                <td>${r.descricao}</td>
                <td>${cartao ? formatCartao(cartao) : '-'}</td>
                <td><span class="tag">${r.categoria}</span></td>
                <td>${formatBRL(r.valor)}</td>
                <td>${r.mesInicio}</td>
                <td>
                  <button class="btn-ghost" data-editar-rec="${r.id}">Editar</button>
                  <button class="btn-danger" data-del-rec="${r.id}">Remover</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      `;
      el.querySelectorAll('[data-editar-rec]').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = recorrentes.find(x => x.id === btn.dataset.editarRec);
          editandoRecId = r.id;
          document.getElementById('form-rec-body').classList.remove('collapsed');
          document.getElementById('btn-cancelar-rec').style.display = 'inline-block';
          document.getElementById('btn-add-rec').textContent = 'Atualizar recorrência';
          document.getElementById('r-cartao').value = r.cartaoId;
          document.getElementById('r-descricao').value = r.descricao;
          document.getElementById('r-categoria').value = r.categoria;
          document.getElementById('r-valor').value = r.valor;
          document.getElementById('r-mes-inicio').value = r.mesInicio;
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
      el.querySelectorAll('[data-del-rec]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Remover esta recorrência? Ela deixa de aparecer nas faturas seguintes.')) {
            await deleteDoc(doc(db, 'cartaoRecorrentes', btn.dataset.delRec));
          }
        });
      });
    });
    unsubs.push(unsubRec);

    const unsub = onSnapshot(query(lancamentosCol), (snap) => {
      const todosLancs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      let linhas = [];
      todosLancs.forEach(l => {
        const cartao = cartoes.find(c => c.id === l.cartaoId);
        parcelasPorCompetencia(l, cartao).forEach(p => {
          if (p.mes === mes) linhas.push({ ...l, cartao, valorParcela: p.valor, numero: p.numero, totalParcelas: p.totalParcelas });
        });
      });

      onSnapshot(query(recorrentesCol), (snapRec) => {
        const recorrentes = snapRec.docs.map(d => ({ id: d.id, ...d.data() }));
        let linhasFinal = [...linhas];
        recorrentes.forEach(r => {
          if (r.mesInicio && r.mesInicio <= mes) {
            const cartao = cartoes.find(c => c.id === r.cartaoId);
            linhasFinal.push({
              id: r.id, cartao, descricao: r.descricao, categoria: r.categoria,
              valorParcela: r.valor, parcelado: false, origem: 'recorrente', data: null
            });
          }
        });
        if (filtroCategoria !== 'todas') linhasFinal = linhasFinal.filter(l => l.categoria === filtroCategoria);
        linhasFinal.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

        const el = document.getElementById('lista-lancamentos');
        if (!linhasFinal.length) {
          el.innerHTML = '<div class="empty-state">Nenhum lançamento nessa fatura.</div>';
          return;
        }
        el.innerHTML = `
          <table>
            <thead><tr><th>Data compra</th><th>Cartão</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Parcela</th><th>Origem</th><th></th></tr></thead>
            <tbody>
              ${linhasFinal.map(l => `<tr>
                  <td>${l.data ? formatDate(l.data) : '-'}</td>
                  <td>${l.cartao ? formatCartao(l.cartao) : '-'}</td>
                  <td>${l.descricao}</td>
                  <td><span class="tag">${l.categoria}</span></td>
                  <td>${formatBRL(l.valorParcela)}</td>
                  <td>${l.parcelado ? l.numero + '/' + l.totalParcelas : '-'}</td>
                  <td>${l.origem === 'manual' ? 'Manual' : l.origem === 'recorrente' ? '<span class="tag">Recorrente</span>' : `<span class="tag">${l.origem === 'mercado' ? 'Mercado (auto)' : 'Variáveis (auto)'}</span>`}</td>
                  <td>
                    ${l.origem === 'manual' ? `<button class="btn-ghost" data-editar-lanc="${l.id}">Editar</button><button class="btn-danger" data-del="${l.id}">Remover</button>` : ''}
                    ${l.origem === 'recorrente' ? `<button class="btn-ghost" data-editar-rec-lanc="${l.id}">Editar</button><button class="btn-danger" data-del-rec-lanc="${l.id}">Remover</button>` : ''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>`;
        el.querySelectorAll('[data-editar-lanc]').forEach(btn => {
          btn.addEventListener('click', () => {
            const l = todosLancs.find(x => x.id === btn.dataset.editarLanc);
            editandoLancId = l.id;
            document.getElementById('form-lanc-body').classList.remove('collapsed');
            document.getElementById('btn-cancelar-lanc').style.display = 'inline-block';
            document.getElementById('btn-add-lancamento').textContent = 'Atualizar lançamento';
            document.getElementById('l-cartao').value = l.cartaoId;
            document.getElementById('l-descricao').value = l.descricao;
            document.getElementById('l-categoria').value = l.categoria;
            document.getElementById('l-valor').value = l.valorTotal;
            document.getElementById('l-data').value = l.data;
            document.getElementById('l-parcelado').value = l.parcelado ? 'sim' : 'nao';
            document.getElementById('l-parcelas-wrap').classList.toggle('show', !!l.parcelado);
            if (l.parcelado) document.getElementById('l-parcelas').value = l.numParcelas;
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });
        });
        el.querySelectorAll('[data-del]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (confirm('Remover lançamento?')) await deleteDoc(doc(db, 'cartaoLancamentos', btn.dataset.del));
          });
        });
        el.querySelectorAll('[data-editar-rec-lanc]').forEach(btn => {
          btn.addEventListener('click', () => {
            const r = recorrentes.find(x => x.id === btn.dataset.editarRecLanc);
            editandoRecId = r.id;
            document.getElementById('form-rec-body').classList.remove('collapsed');
            document.getElementById('btn-cancelar-rec').style.display = 'inline-block';
            document.getElementById('btn-add-rec').textContent = 'Atualizar recorrência';
            document.getElementById('r-cartao').value = r.cartaoId;
            document.getElementById('r-descricao').value = r.descricao;
            document.getElementById('r-categoria').value = r.categoria;
            document.getElementById('r-valor').value = r.valor;
            document.getElementById('r-mes-inicio').value = r.mesInicio;
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });
        });
        el.querySelectorAll('[data-del-rec-lanc]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (confirm('Remover esta recorrência? Ela deixa de aparecer nas faturas seguintes.')) {
              await deleteDoc(doc(db, 'cartaoRecorrentes', btn.dataset.delRecLanc));
            }
          });
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
  let filtroCartaoId = 'todos';
  container.innerHTML = `
    <h2 class="module-title">Cartão · Faturas futuras</h2>
    <div class="filters-bar" id="filtro-cartao-faturas-wrap"></div>
    <div id="faturas-content"></div>
  `;

  async function render() {
    const cartoes = await getCartoes();

    const filtroWrap = document.getElementById('filtro-cartao-faturas-wrap');
    filtroWrap.innerHTML = `
      <select id="filtro-cartao-faturas">
        <option value="todos">Todos os cartões (consolidado)</option>
        ${cartoes.map(c => `<option value="${c.id}" ${filtroCartaoId === c.id ? 'selected' : ''}>${formatCartao(c)}</option>`).join('')}
      </select>
    `;
    document.getElementById('filtro-cartao-faturas').addEventListener('change', (e) => {
      filtroCartaoId = e.target.value;
      render();
    });

    const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
    let lancs = snap.docs.map(d => d.data());
    if (filtroCartaoId !== 'todos') lancs = lancs.filter(l => l.cartaoId === filtroCartaoId);

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

    const snapRec = await new Promise(res => { const u = onSnapshot(query(recorrentesCol), s => { res(s); u(); }); });
    let recorrentes = snapRec.docs.map(d => d.data());
    if (filtroCartaoId !== 'todos') recorrentes = recorrentes.filter(r => r.cartaoId === filtroCartaoId);
    recorrentes.forEach(r => {
      meses.forEach(m => {
        if (r.mesInicio && r.mesInicio <= m && totalPorMes[m] !== undefined) totalPorMes[m] += r.valor;
      });
    });

    const cartaoSelecionado = filtroCartaoId !== 'todos' ? cartoes.find(c => c.id === filtroCartaoId) : null;
    document.getElementById('faturas-content').innerHTML = `
      <div class="card">
        <h3>${cartaoSelecionado ? `Comprometimento futuro — ${formatCartao(cartaoSelecionado)}` : 'Comprometimento futuro (todos os cartões, por fatura de vencimento)'}</h3>
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

// Calcula o saldo do vale (Livre ou Voucher) considerando o acúmulo mês a mês:
// saldo disponível = restante do mês anterior + entrada deste mês; saldo restante = disponível - gasto.
function calcularValeAcumulado(tipo, mesAlvo, configs, compras) {
  const mesesConfig = configs.map(c => c.mes).sort();
  if (!mesesConfig.length || mesesConfig[0] > mesAlvo) {
    return { entradaMes: 0, gastoMes: 0, saldoDisponivel: 0, saldoRestante: 0 };
  }
  let mesIter = mesesConfig[0];
  let carryOver = 0;
  let resultado = { entradaMes: 0, gastoMes: 0, saldoDisponivel: 0, saldoRestante: 0 };
  while (mesIter <= mesAlvo) {
    const config = configs.find(c => c.mes === mesIter);
    const entrada = config ? (tipo === 'livre' ? (config.valorMensalLivre || 0) : (config.valorMensalVoucher || 0)) : 0;
    const gasto = compras
      .filter(c => c.formaPagamento === 'vale' && c.valeTitular === 'Natasha' && (c.valeTipo || 'livre') === tipo && monthRefFromDate(c.data) === mesIter)
      .reduce((s, c) => s + (c.valorTotal || 0), 0);
    const disponivel = carryOver + entrada;
    const restante = disponivel - gasto;
    resultado = { entradaMes: entrada, gastoMes: gasto, saldoDisponivel: disponivel, saldoRestante: restante };
    carryOver = restante;
    mesIter = addMonths(mesIter, 1);
  }
  return resultado;
}

export { parcelasPorCompetencia, calcularValeAcumulado };
