import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, currentMonthRef, monthRefFromDate, renderMonthSelector, renderFormToggleHeader, setupFormToggleListeners } from '../helpers.js';

const rendasCol = collection(db, 'rendas');
const contasBancariasCol = collection(db, 'contasBancarias');
const caixasReservaCol = collection(db, 'caixasReserva');

export async function renderRenda(container) {
  const unsubs = [];
  let selectedMonth = currentMonthRef();

  function renderView() {
    container.innerHTML = `
      <h2 class="module-title">Renda e Reservas</h2>
      <div id="month-selector-container"></div>

      <!-- Contas Bancárias -->
      <div class="card">
        ${renderFormToggleHeader('Cadastrar Conta Bancária', 'form-add-conta-bancaria')}
        <div id="form-add-conta-bancaria">
          <div class="grid grid-3">
            <div><label>Titular / Pessoa</label>
              <select id="cb-pessoa">
                <option>Daniel</option>
                <option>Natasha</option>
              </select>
            </div>
            <div><label>Tipo de Conta</label>
              <select id="cb-tipo">
                <option>PF</option>
                <option>PJ</option>
              </select>
            </div>
            <div><label>Nome do Banco / Conta</label><input type="text" id="cb-nome" placeholder="Ex: Nubank, Itaú, C6"></div>
          </div>
          <button class="btn" id="btn-add-conta-bancaria">Adicionar Conta Bancária</button>
        </div>
      </div>

      <!-- Renda do Mês -->
      <div class="card">
        ${renderFormToggleHeader(`Registrar Entrada de Renda (${selectedMonth})`, 'form-add-renda')}
        <div id="form-add-renda">
          <div class="grid grid-3">
            <div><label>Pessoa / Titular</label>
              <select id="r-pessoa">
                <option>Daniel</option>
                <option>Natasha</option>
              </select>
            </div>
            <div><label>Descrição / Fonte</label><input type="text" id="r-descricao" placeholder="Ex: Salário, Prolabore, Freelance"></div>
            <div><label>Valor (R$)</label><input type="number" step="0.01" id="r-valor"></div>
            <div><label>Conta Bancária Recebimento</label>
              <select id="r-conta-id">
                <option value="">Selecione...</option>
              </select>
            </div>
            <div><label>Data Entrada</label><input type="date" id="r-data"></div>
          </div>
          <button class="btn" id="btn-add-renda">Salvar Renda do Mês</button>
        </div>
      </div>

      <div class="card">
        <h3>Resumo das Rendas do Mês (${selectedMonth})</h3>
        <div id="lista-rendas"></div>
      </div>

      <!-- Caixas de Reserva -->
      <div class="card">
        ${renderFormToggleHeader('Cadastrar Caixa de Reserva', 'form-add-caixa')}
        <div id="form-add-caixa">
          <div class="grid grid-3">
            <div><label>Pessoa</label>
              <select id="cx-pessoa">
                <option>Daniel</option>
                <option>Natasha</option>
              </select>
            </div>
            <div><label>Nome da Caixa</label><input type="text" id="cx-nome" placeholder="Ex: Emergência, Viagem, Oportunidades"></div>
            <div><label>Saldo Atual (R$)</label><input type="number" step="0.01" id="cx-saldo"></div>
          </div>
          <button class="btn" id="btn-add-caixa">Adicionar Caixa de Reserva</button>
        </div>
      </div>

      <div class="card">
        <h3>Minhas Caixas de Reserva</h3>
        <div id="resumo-reservas-totais" class="grid grid-3" style="margin-bottom:20px;"></div>
        <div id="lista-caixas-reserva"></div>
      </div>

      <div id="modal-edit-container"></div>
    `;

    const monthSelector = renderMonthSelector(selectedMonth, (newMonth) => {
      selectedMonth = newMonth;
      renderView();
    });
    container.querySelector('#month-selector-container').appendChild(monthSelector);
    setupFormToggleListeners(container);

    let contasData = [];
    let rendasData = [];
    let caixasData = [];

    // Helper p/ formatar 'Pessoa - Tipo - Nome'
    function formatContaLabel(c) {
      return `${c.pessoa || 'Pessoa'} - ${c.tipo || 'PF'} - ${c.nome || 'Banco'}`;
    }

    // 1. Cadastrar Conta Bancária
    container.querySelector('#btn-add-conta-bancaria').addEventListener('click', async () => {
      const pessoa = container.querySelector('#cb-pessoa').value;
      const tipo = container.querySelector('#cb-tipo').value;
      const nome = container.querySelector('#cb-nome').value.trim();

      if (!nome) return alert('Digite o nome do banco/conta!');

      await addDoc(contasBancariasCol, { pessoa, tipo, nome });
      container.querySelector('#cb-nome').value = '';
    });

    // 2. Cadastrar Renda
    container.querySelector('#btn-add-renda').addEventListener('click', async () => {
      const pessoa = container.querySelector('#r-pessoa').value;
      const descricao = container.querySelector('#r-descricao').value.trim();
      const valor = parseFloat(container.querySelector('#r-valor').value) || 0;
      const contaId = container.querySelector('#r-conta-id').value;
      const data = container.querySelector('#r-data').value || `${selectedMonth}-01`;

      if (!descricao || !valor) return alert('Preencha a descrição e valor!');

      await addDoc(rendasCol, {
        pessoa,
        descricao,
        valor,
        contaId,
        data,
        mesRef: monthRefFromDate(data)
      });

      container.querySelector('#r-descricao').value = '';
      container.querySelector('#r-valor').value = '';
    });

    // 3. Cadastrar Caixa Reserva
    container.querySelector('#btn-add-caixa').addEventListener('click', async () => {
      const pessoa = container.querySelector('#cx-pessoa').value;
      const nome = container.querySelector('#cx-nome').value.trim();
      const saldo = parseFloat(container.querySelector('#cx-saldo').value) || 0;

      if (!nome) return alert('Digite o nome da caixa de reserva!');

      await addDoc(caixasReservaCol, { pessoa, nome, saldo });
      container.querySelector('#cx-nome').value = '';
      container.querySelector('#cx-saldo').value = '';
    });

    // Subscrições
    const unsubContas = onSnapshot(query(contasBancariasCol), (snap) => {
      contasData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const selectEl = container.querySelector('#r-conta-id');
      if (selectEl) {
        selectEl.innerHTML = `<option value="">Selecione...</option>` +
          contasData.map(c => `<option value="${c.id}">${formatContaLabel(c)}</option>`).join('');
      }
    });

    const unsubRendas = onSnapshot(query(rendasCol), (snap) => {
      rendasData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const rendasDoMes = rendasData.filter(r => (r.mesRef || monthRefFromDate(r.data)) === selectedMonth);

      const listEl = container.querySelector('#lista-rendas');
      if (!rendasDoMes.length) {
        listEl.innerHTML = '<div class="empty-state">Nenhuma renda registrada para este mês.</div>';
      } else {
        listEl.innerHTML = `
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Descrição</th>
                  <th>Conta Destino</th>
                  <th>Valor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                ${rendasDoMes.map(r => {
                  const contaObj = contasData.find(c => c.id === r.contaId);
                  return `
                    <tr>
                      <td><strong>${r.pessoa}</strong></td>
                      <td>${r.descricao}</td>
                      <td>${contaObj ? formatContaLabel(contaObj) : '-'}</td>
                      <td><strong style="color:var(--olive)">${formatBRL(r.valor)}</strong></td>
                      <td>
                        <button class="btn-ghost" data-edit-renda="${r.id}">Editar</button>
                        <button class="btn-danger" data-del-renda="${r.id}">Excluir</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;

        listEl.querySelectorAll('[data-del-renda]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (confirm('Excluir renda?')) await deleteDoc(doc(db, 'rendas', btn.dataset.delRenda));
          });
        });

        listEl.querySelectorAll('[data-edit-renda]').forEach(btn => {
          btn.addEventListener('click', () => {
            const r = rendasDoMes.find(x => x.id === btn.dataset.editRenda);
            openEditRendaModal(r);
          });
        });
      }
    });

    const unsubCaixas = onSnapshot(query(caixasReservaCol), (snap) => {
      caixasData = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      let totalDaniel = 0;
      let totalNatasha = 0;

      caixasData.forEach(cx => {
        if (cx.pessoa === 'Daniel') totalDaniel += (cx.saldo || 0);
        if (cx.pessoa === 'Natasha') totalNatasha += (cx.saldo || 0);
      });

      const totalGeral = totalDaniel + totalNatasha;

      container.querySelector('#resumo-reservas-totais').innerHTML = `
        <div class="ledger-figure">
          <div class="value">${formatBRL(totalDaniel)}</div>
          <div class="label">Total Daniel</div>
        </div>
        <div class="ledger-figure">
          <div class="value">${formatBRL(totalNatasha)}</div>
          <div class="label">Total Natasha</div>
        </div>
        <div class="ledger-figure">
          <div class="value" style="color:var(--gold)">${formatBRL(totalGeral)}</div>
          <div class="label">Total Geral Consolidado</div>
        </div>
      `;

      const listEl = container.querySelector('#lista-caixas-reserva');
      if (!caixasData.length) {
        listEl.innerHTML = '<div class="empty-state">Nenhuma caixa de reserva cadastrada.</div>';
      } else {
        listEl.innerHTML = `
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Nome da Caixa</th>
                  <th>Saldo Atual</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                ${caixasData.map(cx => `
                  <tr>
                    <td><strong>${cx.pessoa}</strong></td>
                    <td>${cx.nome}</td>
                    <td><strong style="color:var(--gold)">${formatBRL(cx.saldo)}</strong></td>
                    <td>
                      <button class="btn-ghost" data-edit-caixa="${cx.id}">Editar Saldo</button>
                      <button class="btn-danger" data-del-caixa="${cx.id}">Excluir</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;

        listEl.querySelectorAll('[data-del-caixa]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (confirm('Excluir esta caixa?')) await deleteDoc(doc(db, 'caixasReserva', btn.dataset.delCaixa));
          });
        });

        listEl.querySelectorAll('[data-edit-caixa]').forEach(btn => {
          btn.addEventListener('click', () => {
            const cx = caixasData.find(x => x.id === btn.dataset.editCaixa);
            openEditCaixaModal(cx);
          });
        });
      }
    });

    unsubs.push(unsubContas, unsubRendas, unsubCaixas);
  }

  function openEditRendaModal(r) {
    const modalContainer = container.querySelector('#modal-edit-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-content">
          <h3>Editar Renda</h3>
          <label>Pessoa</label>
          <select id="edit-r-pessoa">
            <option ${r.pessoa === 'Daniel' ? 'selected' : ''}>Daniel</option>
            <option ${r.pessoa === 'Natasha' ? 'selected' : ''}>Natasha</option>
          </select>
          <label>Descrição</label>
          <input type="text" id="edit-r-descricao" value="${r.descricao}">
          <label>Valor (R$)</label>
          <input type="number" step="0.01" id="edit-r-valor" value="${r.valor}">
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
      await updateDoc(doc(db, 'rendas', r.id), {
        pessoa: modalContainer.querySelector('#edit-r-pessoa').value,
        descricao: modalContainer.querySelector('#edit-r-descricao').value,
        valor: parseFloat(modalContainer.querySelector('#edit-r-valor').value) || 0
      });
      modalContainer.innerHTML = '';
    });
  }

  function openEditCaixaModal(cx) {
    const modalContainer = container.querySelector('#modal-edit-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-content">
          <h3>Editar Caixa de Reserva</h3>
          <label>Nome da Caixa</label>
          <input type="text" id="edit-cx-nome" value="${cx.nome}">
          <label>Saldo Atual (R$)</label>
          <input type="number" step="0.01" id="edit-cx-saldo" value="${cx.saldo}">
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
      await updateDoc(doc(db, 'caixasReserva', cx.id), {
        nome: modalContainer.querySelector('#edit-cx-nome').value,
        saldo: parseFloat(modalContainer.querySelector('#edit-cx-saldo').value) || 0
      });
      modalContainer.innerHTML = '';
    });
  }

  renderView();
  return unsubs;
}
