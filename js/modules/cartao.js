import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, formatDate, todayISO, currentMonthRef, monthRefFromDate, CATEGORIAS_GASTOS, renderMonthSelector, renderFormToggleHeader, setupFormToggleListeners } from '../helpers.js';

const cartoesCol = collection(db, 'cartoes');
const lancamentosCol = collection(db, 'cartaoLancamentos');
const mercadoComprasCol = collection(db, 'mercadoCompras');
const valeConfigCol = collection(db, 'valeAlimentacaoConfig');

// Retorna cartões formatados "Apelido + Titular"
export async function getCartoesFormated() {
  return new Promise((resolve) => {
    const unsub = onSnapshot(cartoesCol, (snap) => {
      const list = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          label: `${data.apelido || 'Cartão'} - ${data.titular || 'Pessoa'}`
        };
      });
      resolve(list);
      unsub();
    });
  });
}

// Upserts para integrações de Mercado e Variáveis
export async function upsertLancamentoDeMercado({ mercadoCompraId, cartaoId, valorTotal, parcelado, numParcelas, data }) {
  const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
  const existing = snap.docs.find(d => d.data().mercadoCompraId === mercadoCompraId);
  const payload = {
    cartaoId,
    descricao: 'Compra de mercado',
    categoria: 'Mercado',
    valorTotal,
    parcelado: !!parcelado,
    numParcelas: parcelado ? numParcelas : 1,
    data,
    origem: 'mercado',
    mercadoCompraId
  };
  if (existing) {
    await updateDoc(doc(db, 'cartaoLancamentos', existing.id), payload);
  } else {
    await addDoc(lancamentosCol, payload);
  }
}

export async function removerLancamentoDeMercado(mercadoCompraId) {
  const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
  const existing = snap.docs.find(d => d.data().mercadoCompraId === mercadoCompraId);
  if (existing) await deleteDoc(doc(db, 'cartaoLancamentos', existing.id));
}

export async function upsertLancamentoDeVariavel({ variavelId, cartaoId, descricao, categoria, valorTotal, parcelado, numParcelas, data }) {
  const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
  const existing = snap.docs.find(d => d.data().variavelId === variavelId);
  const payload = {
    cartaoId,
    descricao,
    categoria,
    valorTotal,
    parcelado: !!parcelado,
    numParcelas: parcelado ? numParcelas : 1,
    data,
    origem: 'variaveis',
    variavelId
  };
  if (existing) {
    await updateDoc(doc(db, 'cartaoLancamentos', existing.id), payload);
  } else {
    await addDoc(lancamentosCol, payload);
  }
}

export async function removerLancamentoDeVariavel(variavelId) {
  const snap = await new Promise(res => { const u = onSnapshot(query(lancamentosCol), s => { res(s); u(); }); });
  const existing = snap.docs.find(d => d.data().variavelId === variavelId);
  if (existing) await deleteDoc(doc(db, 'cartaoLancamentos', existing.id));
}

// 1. Submódulo Cartões
export async function renderCartoes(container) {
  const unsubs = [];
  let cartoesList = [];

  function renderView() {
    container.innerHTML = `
      <h2 class="module-title">Cartões de Crédito</h2>
      <div class="card">
        ${renderFormToggleHeader('Cadastrar Novo Cartão', 'form-add-cartao')}
        <div id="form-add-cartao">
          <div class="grid grid-4">
            <div><label>Apelido do Cartão</label><input type="text" id="c-apelido" placeholder="Ex: Nubank, Inter, XP"></div>
            <div><label>Titular</label>
              <select id="c-titular">
                <option>Daniel</option>
                <option>Natasha</option>
              </select>
            </div>
            <div><label>Dia Fechamento</label><input type="number" id="c-fechamento" min="1" max="31"></div>
            <div><label>Dia Vencimento</label><input type="number" id="c-vencimento" min="1" max="31"></div>
          </div>
          <button class="btn" id="btn-add-cartao">Adicionar Cartão</button>
        </div>
      </div>

      <div class="card">
        <h3>Cartões Cadastrados</h3>
        <div id="lista-cartoes"></div>
      </div>

      <div id="modal-edit-container"></div>
    `;

    setupFormToggleListeners(container);

    container.querySelector('#btn-add-cartao').addEventListener('click', async () => {
      const apelido = container.querySelector('#c-apelido').value.trim();
      const titular = container.querySelector('#c-titular').value;
      const diaFechamento = parseInt(container.querySelector('#c-fechamento').value) || null;
      const diaVencimento = parseInt(container.querySelector('#c-vencimento').value) || null;

      if (!apelido) return alert('Digite o apelido do cartão!');

      await addDoc(cartoesCol, { apelido, titular, diaFechamento, diaVencimento });
      container.querySelector('#c-apelido').value = '';
    });

    const unsub = onSnapshot(cartoesCol, (snap) => {
      cartoesList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const listEl = container.querySelector('#lista-cartoes');
      if (!cartoesList.length) {
        listEl.innerHTML = '<div class="empty-state">Nenhum cartão cadastrado ainda.</div>';
        return;
      }
      listEl.innerHTML = `
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Identificação</th>
                <th>Titular</th>
                <th>Fechamento</th>
                <th>Vencimento</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${cartoesList.map(c => `
                <tr>
                  <td><strong>${c.apelido} - ${c.titular}</strong></td>
                  <td>${c.titular}</td>
                  <td>Dia ${c.diaFechamento || '-'}</td>
                  <td>Dia ${c.diaVencimento || '-'}</td>
                  <td>
                    <button class="btn-ghost" data-edit="${c.id}">Editar</button>
                    <button class="btn-danger" data-del="${c.id}">Remover</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      listEl.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Remover cartão?')) await deleteDoc(doc(db, 'cartoes', btn.dataset.del));
        });
      });

      listEl.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
          const c = cartoesList.find(x => x.id === btn.dataset.edit);
          openEditModal(c);
        });
      });
    });

    unsubs.push(unsub);
  }

  function openEditModal(c) {
    const modalContainer = container.querySelector('#modal-edit-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-content">
          <h3>Editar Cartão</h3>
          <label>Apelido</label>
          <input type="text" id="edit-c-apelido" value="${c.apelido}">
          <label>Titular</label>
          <select id="edit-c-titular">
            <option ${c.titular === 'Daniel' ? 'selected' : ''}>Daniel</option>
            <option ${c.titular === 'Natasha' ? 'selected' : ''}>Natasha</option>
          </select>
          <label>Dia Fechamento</label>
          <input type="number" id="edit-c-fechamento" value="${c.diaFechamento || ''}">
          <label>Dia Vencimento</label>
          <input type="number" id="edit-c-vencimento" value="${c.diaVencimento || ''}">
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
            <button class="btn-ghost" id="btn-cancel-edit">Cancelar</button>
            <button class="btn" id="btn-save-edit">Salvar Alterações</button>
          </div>
        </div>
      </div>
    `;

    modalContainer.querySelector('#btn-cancel-edit').addEventListener('click', () => {
      modalContainer.innerHTML = '';
    });

    modalContainer.querySelector('#btn-save-edit').addEventListener('click', async () => {
      await updateDoc(doc(db, 'cartoes', c.id), {
        apelido: modalContainer.querySelector('#edit-c-apelido').value,
        titular: modalContainer.querySelector('#edit-c-titular').value,
        diaFechamento: parseInt(modalContainer.querySelector('#edit-c-fechamento').value) || null,
        diaVencimento: parseInt(modalContainer.querySelector('#edit-c-vencimento').value) || null
      });
      modalContainer.innerHTML = '';
    });
  }

  renderView();
  return unsubs;
}

// 2. Submódulo Vale Alimentação
export async function renderVale(container) {
  const unsubs = [];
  let selectedMonth = currentMonthRef();

  function renderView() {
    container.innerHTML = `
      <h2 class="module-title">Vale Alimentação (Natasha)</h2>
      <div id="month-selector-container"></div>

      <div class="card">
        <h3>Configuração do Vale (${selectedMonth})</h3>
        <p style="color:var(--text-dim); font-size:13px;">O vale do Daniel não é controlado aqui — apenas o da Natasha para acompanhamento do mercado.</p>
        <div class="grid grid-2" style="max-width:500px">
          <div>
            <label>Valor recebido no mês</label>
            <input type="number" step="0.01" id="vale-valor-mensal">
          </div>
        </div>
        <button class="btn" id="btn-salvar-vale">Salvar Valor do Mês</button>
      </div>

      <div class="card">
        <h3>Consumo em Mercado neste Mês</h3>
        <div id="vale-resumo"></div>
      </div>
    `;

    const monthSelector = renderMonthSelector(selectedMonth, (newMonth) => {
      selectedMonth = newMonth;
      renderView();
    });
    container.querySelector('#month-selector-container').appendChild(monthSelector);

    // Carregar config
    let configExistente = null;
    const unsubConfig = onSnapshot(query(valeConfigCol), (snap) => {
      configExistente = snap.docs.find(d => d.data().mes === selectedMonth);
      if (configExistente) {
        container.querySelector('#vale-valor-mensal').value = configExistente.data().valorMensal;
      } else {
        container.querySelector('#vale-valor-mensal').value = '';
      }
    });

    container.querySelector('#btn-salvar-vale').addEventListener('click', async () => {
      const valorMensal = parseFloat(container.querySelector('#vale-valor-mensal').value) || 0;
      if (configExistente) {
        await updateDoc(doc(db, 'valeAlimentacaoConfig', configExistente.id), { valorMensal });
      } else {
        await addDoc(valeConfigCol, { mes: selectedMonth, valorMensal });
      }
      alert('Valor do vale salvo!');
    });

    const unsubMercado = onSnapshot(query(mercadoComprasCol), (snap) => {
      const compras = snap.docs.map(d => d.data());
      const usadasVale = compras.filter(c =>
        c.formaPagamento === 'vale' && c.valeTitular === 'Natasha' && monthRefFromDate(c.data) === selectedMonth
      );
      const totalUsado = usadasVale.reduce((s, c) => s + (c.valorTotal || 0), 0);
      const valorMensal = configExistente ? configExistente.data().valorMensal : 0;
      const percentual = valorMensal > 0 ? Math.min(100, (totalUsado / valorMensal) * 100) : 0;
      const restante = valorMensal - totalUsado;

      container.querySelector('#vale-resumo').innerHTML = `
        <div class="grid grid-3">
          <div class="ledger-figure">
            <div class="value">${formatBRL(totalUsado)}</div>
            <div class="label">Usado em Mercado</div>
          </div>
          <div class="ledger-figure">
            <div class="value">${percentual.toFixed(0)}%</div>
            <div class="label">Utilizado do Disponível</div>
          </div>
          <div class="ledger-figure">
            <div class="value" style="color:${restante >= 0 ? 'var(--olive)' : 'var(--terracota)'}">${formatBRL(restante)}</div>
            <div class="label">Saldo Restante</div>
          </div>
        </div>
        <div style="margin-top:16px; background:var(--surface-2); border-radius:6px; height:10px; overflow:hidden">
          <div style="width:${percentual}%; height:100%; background:${percentual >= 90 ? 'var(--terracota)' : 'var(--gold)'}"></div>
        </div>
        <p style="color:var(--text-dim); font-size:13px; margin-top:16px">${usadasVale.length} compra(s) de mercado paga(s) com vale este mês.</p>
      `;
    });

    unsubs.push(unsubConfig, unsubMercado);
  }

  renderView();
  return unsubs;
}

// 3. Submódulo Lançamentos de Cartão
export async function renderLancamentosCartao(container) {
  const unsubs = [];
  let selectedMonth = currentMonthRef();
  let cartoes = await getCartoesFormated();

  function renderView() {
    container.innerHTML = `
      <h2 class="module-title">Lançamentos de Cartão</h2>
      <div id="month-selector-container"></div>

      <div class="card">
        ${renderFormToggleHeader('Novo Lançamento Manual no Cartão', 'form-add-lanc')}
        <div id="form-add-lanc">
          <p style="color:var(--text-dim); font-size:13px; margin-top:0">Atenção: compras lançadas no módulo Mercado ou em Variáveis já aparecem aqui automaticamente.</p>
          <div class="grid grid-3">
            <div><label>Cartão (Apelido - Titular)</label>
              <select id="l-cartao">
                ${cartoes.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
              </select>
            </div>
            <div><label>Descrição</label><input type="text" id="l-descricao" placeholder="Ex: Roupas, Eletrônicos"></div>
            <div><label>Categoria</label>
              <select id="l-categoria">
                ${CATEGORIAS_GASTOS.map(c => `<option>${c}</option>`).join('')}
              </select>
            </div>
            <div><label>Valor Total (R$)</label><input type="number" step="0.01" id="l-valor"></div>
            <div><label>Data</label><input type="date" id="l-data" value="${todayISO()}"></div>
            <div><label>Parcelado?</label>
              <select id="l-parcelado"><option value="nao">Não</option><option value="sim">Sim</option></select>
            </div>
            <div id="l-parcelas-wrap" class="conditional"><label>Número de Parcelas</label><input type="number" id="l-parcelas" min="2" value="2"></div>
          </div>
          <button class="btn" id="btn-add-lancamento">Cadastrar Lançamento</button>
        </div>
      </div>

      <div class="card">
        <h3>Filtro por Categoria</h3>
        <select id="filtro-categoria" style="max-width:300px; margin-bottom:0">
          <option value="TODAS">Todas as Categorias</option>
          ${CATEGORIAS_GASTOS.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>

      <div class="card">
        <h3>Extrato de Cartões (${selectedMonth})</h3>
        <div id="lista-lancamentos"></div>
      </div>

      <div id="modal-edit-container"></div>
    `;

    const monthSelector = renderMonthSelector(selectedMonth, (newMonth) => {
      selectedMonth = newMonth;
      renderView();
    });
    container.querySelector('#month-selector-container').appendChild(monthSelector);
    setupFormToggleListeners(container);

    const parceladoSel = container.querySelector('#l-parcelado');
    parceladoSel.addEventListener('change', () => {
      container.querySelector('#l-parcelas-wrap').classList.toggle('show', parceladoSel.value === 'sim');
    });

    container.querySelector('#btn-add-lancamento').addEventListener('click', async () => {
      const cartaoId = container.querySelector('#l-cartao').value;
      const descricao = container.querySelector('#l-descricao').value.trim() || 'Sem descrição';
      const categoria = container.querySelector('#l-categoria').value;
      const valorTotal = parseFloat(container.querySelector('#l-valor').value) || 0;
      const data = container.querySelector('#l-data').value;
      const parcelado = parceladoSel.value === 'sim';
      const numParcelas = parcelado ? (parseInt(container.querySelector('#l-parcelas').value) || 1) : 1;

      if (!cartaoId || !valorTotal) return alert('Preencha os campos obrigatórios!');

      await addDoc(lancamentosCol, {
        cartaoId,
        descricao,
        categoria,
        valorTotal,
        parcelado,
        numParcelas,
        data,
        origem: 'manual'
      });

      container.querySelector('#l-descricao').value = '';
      container.querySelector('#l-valor').value = '';
    });

    let catFiltro = 'TODAS';
    container.querySelector('#filtro-categoria').addEventListener('change', (e) => {
      catFiltro = e.target.value;
      renderList();
    });

    let lancsData = [];

    function renderList() {
      let filtrados = lancsData.filter(l => monthRefFromDate(l.data) === selectedMonth);
      if (catFiltro !== 'TODAS') {
        filtrados = filtrados.filter(l => l.categoria === catFiltro);
      }

      const listEl = container.querySelector('#lista-lancamentos');
      if (!filtrados.length) {
        listEl.innerHTML = '<div class="empty-state">Nenhum lançamento encontrado para os filtros selecionados.</div>';
        return;
      }

      listEl.innerHTML = `
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Cartão (Apelido - Titular)</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Valor</th>
                <th>Parcelas</th>
                <th>Origem</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${filtrados.map(l => {
                const cartao = cartoes.find(c => c.id === l.cartaoId);
                const cartaoLabel = cartao ? cartao.label : 'Cartão Desconhecido';
                return `
                  <tr>
                    <td>${formatDate(l.data)}</td>
                    <td><strong>${cartaoLabel}</strong></td>
                    <td>${l.descricao}</td>
                    <td><span class="tag">${l.categoria}</span></td>
                    <td>${formatBRL(l.valorTotal)}</td>
                    <td>${l.parcelado ? l.numParcelas + 'x' : '1x'}</td>
                    <td>
                      ${l.origem === 'mercado' ? '<span class="tag tag-olive">Mercado</span>' : (l.origem === 'variaveis' ? '<span class="tag tag-terracota">Variáveis</span>' : '<span class="tag">Manual</span>')}
                    </td>
                    <td>
                      <button class="btn-ghost" data-edit="${l.id}">Editar</button>
                      <button class="btn-danger" data-del="${l.id}">Excluir</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      listEl.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Remover lançamento?')) await deleteDoc(doc(db, 'cartaoLancamentos', btn.dataset.del));
        });
      });

      listEl.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
          const item = filtrados.find(x => x.id === btn.dataset.edit);
          openEditModal(item);
        });
      });
    }

    const unsub = onSnapshot(query(lancamentosCol), (snap) => {
      lancsData = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                           .sort((a, b) => b.data.localeCompare(a.data));
      renderList();
    });

    unsubs.push(unsub);
  }

  function openEditModal(item) {
    const modalContainer = container.querySelector('#modal-edit-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-content">
          <h3>Editar Lançamento do Cartão</h3>
          <label>Cartão</label>
          <select id="edit-l-cartao">
            ${cartoes.map(c => `<option value="${c.id}" ${item.cartaoId === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
          <label>Descrição</label>
          <input type="text" id="edit-l-descricao" value="${item.descricao}">
          <label>Categoria</label>
          <select id="edit-l-categoria">
            ${CATEGORIAS_GASTOS.map(c => `<option ${item.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
          <label>Valor Total (R$)</label>
          <input type="number" step="0.01" id="edit-l-valor" value="${item.valorTotal}">
          <label>Data</label>
          <input type="date" id="edit-l-data" value="${item.data}">
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
            <button class="btn-ghost" id="btn-cancel-edit">Cancelar</button>
            <button class="btn" id="btn-save-edit">Salvar Alterações</button>
          </div>
        </div>
      </div>
    `;

    modalContainer.querySelector('#btn-cancel-edit').addEventListener('click', () => {
      modalContainer.innerHTML = '';
    });

    modalContainer.querySelector('#btn-save-edit').addEventListener('click', async () => {
      await updateDoc(doc(db, 'cartaoLancamentos', item.id), {
        cartaoId: modalContainer.querySelector('#edit-l-cartao').value,
        descricao: modalContainer.querySelector('#edit-l-descricao').value,
        categoria: modalContainer.querySelector('#edit-l-categoria').value,
        valorTotal: parseFloat(modalContainer.querySelector('#edit-l-valor').value) || 0,
        data: modalContainer.querySelector('#edit-l-data').value
      });
      modalContainer.innerHTML = '';
    });
  }

  renderView();
  return unsubs;
}

// 4. Submódulo Faturas Futuras
export async function renderFaturas(container) {
  const unsubs = [];
  let selectedMonth = currentMonthRef();

  function renderView() {
    container.innerHTML = `
      <h2 class="module-title">Faturas Futuras do Cartão</h2>
      <div id="month-selector-container"></div>
      <div class="card">
        <h3>Comprometimento dos Próximos 6 Meses (Partindo de ${selectedMonth})</h3>
        <div id="grid-faturas" class="grid grid-3" style="margin-top:16px"></div>
      </div>
    `;

    const monthSelector = renderMonthSelector(selectedMonth, (newMonth) => {
      selectedMonth = newMonth;
      renderView();
    });
    container.querySelector('#month-selector-container').appendChild(monthSelector);

    const unsub = onSnapshot(query(lancamentosCol), (snap) => {
      const lancs = snap.docs.map(d => d.data());

      const meses = [];
      const [anoBase, mesBase] = selectedMonth.split('-').map(Number);

      for (let i = 0; i < 6; i++) {
        const d = new Date(anoBase, (mesBase - 1) + i, 1);
        meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }

      const totalPorMes = {};
      meses.forEach(m => totalPorMes[m] = 0);

      lancs.forEach(l => {
        const parcelas = l.parcelado ? l.numParcelas : 1;
        const valorParcela = l.valorTotal / parcelas;
        const lMesBase = monthRefFromDate(l.data);
        const [anoL, mesL] = lMesBase.split('-').map(Number);

        for (let p = 0; p < parcelas; p++) {
          const d = new Date(anoL, (mesL - 1) + p, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (totalPorMes[key] !== undefined) totalPorMes[key] += valorParcela;
        }
      });

      container.querySelector('#grid-faturas').innerHTML = meses.map(m => `
        <div class="ledger-figure">
          <div class="value">${formatBRL(totalPorMes[m])}</div>
          <div class="label">Mês: ${m}</div>
        </div>
      `).join('');
    });

    unsubs.push(unsub);
  }

  renderView();
  return unsubs;
}
