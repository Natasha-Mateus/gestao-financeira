import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, formatDate, todayISO, currentMonthRef, monthRefFromDate, CATEGORIAS_GASTOS, renderMonthSelector, renderFormToggleHeader, setupFormToggleListeners } from '../helpers.js';
import { getCartoesFormated, upsertLancamentoDeVariavel, removerLancamentoDeVariavel } from './cartao.js';

const variaveisCol = collection(db, 'despesasVariaveis');

export async function renderVariaveis(container) {
  const unsubs = [];
  let selectedMonth = currentMonthRef();
  let cartoes = await getCartoesFormated();

  function renderView() {
    container.innerHTML = `
      <h2 class="module-title">Despesas Variáveis (Dia a Dia)</h2>
      <div id="month-selector-container"></div>

      <div class="card">
        ${renderFormToggleHeader('Novo Gasto Variável', 'form-add-var')}
        <div id="form-add-var">
          <div class="grid grid-3">
            <div><label>Descrição</label><input type="text" id="v-descricao" placeholder="Ex: Almoço, Farmácia, Uber"></div>
            <div><label>Valor (R$)</label><input type="number" step="0.01" id="v-valor"></div>
            <div><label>Data</label><input type="date" id="v-data" value="${todayISO()}"></div>
            <div><label>Categoria</label>
              <select id="v-categoria">
                ${CATEGORIAS_GASTOS.map(c => `<option>${c}</option>`).join('')}
              </select>
            </div>
            <div><label>Forma de Pagamento</label>
              <select id="v-forma-pagamento">
                <option value="PIX / Débito">PIX / Débito</option>
                <option value="Dinheiro">Dinheiro</option>
                <option value="Crédito">Cartão de Crédito</option>
              </select>
            </div>
            <div id="v-cartao-wrap" class="conditional">
              <label>Selecione o Cartão</label>
              <select id="v-cartao-id">
                <option value="">Selecione...</option>
                ${cartoes.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
              </select>
            </div>
            <div id="v-parcelado-wrap" class="conditional">
              <label>Parcelado?</label>
              <select id="v-parcelado">
                <option value="nao">Não</option>
                <option value="sim">Sim</option>
              </select>
            </div>
            <div id="v-parcelas-wrap" class="conditional">
              <label>Nº de Parcelas</label>
              <input type="number" id="v-num-parcelas" min="2" value="2">
            </div>
          </div>
          <button class="btn" id="btn-add-var">Registrar Gasto</button>
        </div>
      </div>

      <div class="card">
        <h3>Resumo do Mês (${selectedMonth})</h3>
        <div class="grid grid-3" id="v-resumo-grid"></div>
      </div>

      <div class="card">
        <h3>Lançamentos do Mês</h3>
        <div id="lista-variaveis"></div>
      </div>

      <div id="modal-edit-container"></div>
    `;

    const monthSelector = renderMonthSelector(selectedMonth, (newMonth) => {
      selectedMonth = newMonth;
      renderView();
    });
    container.querySelector('#month-selector-container').appendChild(monthSelector);
    setupFormToggleListeners(container);

    const formaSelect = container.querySelector('#v-forma-pagamento');
    const cartaoWrap = container.querySelector('#v-cartao-wrap');
    const parceladoWrap = container.querySelector('#v-parcelado-wrap');
    const parcelasWrap = container.querySelector('#v-parcelas-wrap');
    const parceladoSelect = container.querySelector('#v-parcelado');

    formaSelect.addEventListener('change', () => {
      const isCredito = formaSelect.value === 'Crédito';
      cartaoWrap.classList.toggle('show', isCredito);
      parceladoWrap.classList.toggle('show', isCredito);
      parcelasWrap.classList.toggle('show', isCredito && parceladoSelect.value === 'sim');
    });

    parceladoSelect.addEventListener('change', () => {
      parcelasWrap.classList.toggle('show', formaSelect.value === 'Crédito' && parceladoSelect.value === 'sim');
    });

    // Add
    container.querySelector('#btn-add-var').addEventListener('click', async () => {
      const descricao = container.querySelector('#v-descricao').value.trim();
      const valor = parseFloat(container.querySelector('#v-valor').value) || 0;
      const data = container.querySelector('#v-data').value;
      const categoria = container.querySelector('#v-categoria').value;
      const formaPagamento = formaSelect.value;
      const cartaoId = container.querySelector('#v-cartao-id').value;
      const parcelado = parceladoSelect.value === 'sim';
      const numParcelas = parseInt(container.querySelector('#v-num-parcelas').value) || 1;

      if (!descricao || !valor) return alert('Preencha a descrição e o valor.');
      if (formaPagamento === 'Crédito' && !cartaoId) return alert('Selecione o cartão de crédito.');

      const docRef = await addDoc(variaveisCol, {
        descricao,
        valor,
        data,
        categoria,
        formaPagamento,
        cartaoId: formaPagamento === 'Crédito' ? cartaoId : null,
        parcelado: formaPagamento === 'Crédito' ? parcelado : false,
        numParcelas: (formaPagamento === 'Crédito' && parcelado) ? numParcelas : 1
      });

      // Se for Cartão de Crédito -> Espelhar no módulo de Cartão
      if (formaPagamento === 'Crédito') {
        await upsertLancamentoDeVariavel({
          variavelId: docRef.id,
          cartaoId,
          descricao,
          categoria,
          valorTotal: valor,
          parcelado,
          numParcelas,
          data
        });
      }

      container.querySelector('#v-descricao').value = '';
      container.querySelector('#v-valor').value = '';
    });

    // List & Summary
    const unsub = onSnapshot(query(variaveisCol), (snap) => {
      const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const doMes = todos.filter(t => monthRefFromDate(t.data) === selectedMonth)
                        .sort((a, b) => b.data.localeCompare(a.data));

      let totalGeral = 0;
      let totalCredito = 0;
      let totalOutros = 0;

      const htmlRows = doMes.map(v => {
        totalGeral += v.valor;
        if (v.formaPagamento === 'Crédito') totalCredito += v.valor;
        else totalOutros += v.valor;

        const cartaoObj = cartoes.find(c => c.id === v.cartaoId);
        const infoCartao = cartaoObj ? cartaoObj.label : (v.formaPagamento === 'Crédito' ? 'Crédito' : v.formaPagamento);

        return `
          <tr>
            <td>${formatDate(v.data)}</td>
            <td><strong>${v.descricao}</strong></td>
            <td><span class="tag">${v.categoria}</span></td>
            <td>${v.formaPagamento === 'Crédito' ? `<span class="tag tag-terracota">${infoCartao}</span>` : `<span class="tag">${v.formaPagamento}</span>`}</td>
            <td>${formatBRL(v.valor)} ${v.parcelado ? `(${v.numParcelas}x)` : ''}</td>
            <td>
              <button class="btn-ghost" data-edit="${v.id}">Editar</button>
              <button class="btn-danger" data-del="${v.id}">Excluir</button>
            </td>
          </tr>
        `;
      }).join('');

      container.querySelector('#v-resumo-grid').innerHTML = `
        <div class="ledger-figure">
          <div class="value">${formatBRL(totalGeral)}</div>
          <div class="label">Total Gastos Variáveis</div>
        </div>
        <div class="ledger-figure">
          <div class="value" style="color:var(--terracota)">${formatBRL(totalCredito)}</div>
          <div class="label">No Cartão de Crédito</div>
        </div>
        <div class="ledger-figure">
          <div class="value" style="color:var(--olive)">${formatBRL(totalOutros)}</div>
          <div class="label">À Vista (PIX / Dinheiro)</div>
        </div>
      `;

      const listEl = container.querySelector('#lista-variaveis');
      if (!doMes.length) {
        listEl.innerHTML = '<div class="empty-state">Nenhuma despesa variável registrada neste mês.</div>';
      } else {
        listEl.innerHTML = `
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  <th>Forma Pagamento</th>
                  <th>Valor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>${htmlRows}</tbody>
            </table>
          </div>
        `;

        listEl.querySelectorAll('[data-del]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (confirm('Excluir este lançamento?')) {
              const id = btn.dataset.del;
              await deleteDoc(doc(db, 'despesasVariaveis', id));
              await removerLancamentoDeVariavel(id);
            }
          });
        });

        listEl.querySelectorAll('[data-edit]').forEach(btn => {
          btn.addEventListener('click', () => {
            const item = doMes.find(x => x.id === btn.dataset.edit);
            openEditModal(item);
          });
        });
      }
    });

    unsubs.push(unsub);
  }

  function openEditModal(item) {
    const modalContainer = container.querySelector('#modal-edit-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-content">
          <h3>Editar Gasto Variável</h3>
          <label>Descrição</label>
          <input type="text" id="edit-v-descricao" value="${item.descricao}">
          <label>Valor (R$)</label>
          <input type="number" step="0.01" id="edit-v-valor" value="${item.valor}">
          <label>Data</label>
          <input type="date" id="edit-v-data" value="${item.data}">
          <label>Categoria</label>
          <select id="edit-v-categoria">
            ${CATEGORIAS_GASTOS.map(c => `<option ${item.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
          <label>Forma de Pagamento</label>
          <select id="edit-v-forma">
            <option value="PIX / Débito" ${item.formaPagamento === 'PIX / Débito' ? 'selected' : ''}>PIX / Débito</option>
            <option value="Dinheiro" ${item.formaPagamento === 'Dinheiro' ? 'selected' : ''}>Dinheiro</option>
            <option value="Crédito" ${item.formaPagamento === 'Crédito' ? 'selected' : ''}>Cartão de Crédito</option>
          </select>
          <div id="edit-v-cartao-wrap" class="${item.formaPagamento === 'Crédito' ? 'show' : 'conditional'}">
            <label>Cartão</label>
            <select id="edit-v-cartao-id">
              ${cartoes.map(c => `<option value="${c.id}" ${item.cartaoId === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
            </select>
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
            <button class="btn-ghost" id="btn-cancel-edit">Cancelar</button>
            <button class="btn" id="btn-save-edit">Salvar Alterações</button>
          </div>
        </div>
      </div>
    `;

    const formaSel = modalContainer.querySelector('#edit-v-forma');
    formaSel.addEventListener('change', () => {
      modalContainer.querySelector('#edit-v-cartao-wrap').classList.toggle('show', formaSel.value === 'Crédito');
    });

    modalContainer.querySelector('#btn-cancel-edit').addEventListener('click', () => {
      modalContainer.innerHTML = '';
    });

    modalContainer.querySelector('#btn-save-edit').addEventListener('click', async () => {
      const descricao = modalContainer.querySelector('#edit-v-descricao').value;
      const valor = parseFloat(modalContainer.querySelector('#edit-v-valor').value) || 0;
      const data = modalContainer.querySelector('#edit-v-data').value;
      const categoria = modalContainer.querySelector('#edit-v-categoria').value;
      const formaPagamento = formaSel.value;
      const cartaoId = modalContainer.querySelector('#edit-v-cartao-id').value;

      await updateDoc(doc(db, 'despesasVariaveis', item.id), {
        descricao,
        valor,
        data,
        categoria,
        formaPagamento,
        cartaoId: formaPagamento === 'Crédito' ? cartaoId : null
      });

      if (formaPagamento === 'Crédito') {
        await upsertLancamentoDeVariavel({
          variavelId: item.id,
          cartaoId,
          descricao,
          categoria,
          valorTotal: valor,
          parcelado: item.parcelado || false,
          numParcelas: item.numParcelas || 1,
          data
        });
      } else {
        await removerLancamentoDeVariavel(item.id);
      }

      modalContainer.innerHTML = '';
    });
  }

  renderView();
  return unsubs;
}
