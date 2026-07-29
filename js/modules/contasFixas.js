import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, currentMonthRef, renderMonthSelector, renderFormToggleHeader, setupFormToggleListeners } from '../helpers.js';

const contasCol = collection(db, 'contasFixas');
const baixasCol = collection(db, 'contasFixasBaixas');

export async function renderContasFixas(container) {
  const unsubs = [];
  let selectedMonth = currentMonthRef();

  function renderView() {
    container.innerHTML = `
      <h2 class="module-title">Contas Fixas</h2>
      <div id="month-selector-container"></div>
      
      <div class="card" id="card-form-conta">
        ${renderFormToggleHeader('Nova Conta Fixa', 'form-add-conta')}
        <div id="form-add-conta">
          <div class="grid grid-3">
            <div><label>Nome da Conta</label><input type="text" id="cf-nome" placeholder="Ex: Aluguel, Internet, Luz"></div>
            <div><label>Valor estimado/padrão</label><input type="number" step="0.01" id="cf-valor"></div>
            <div><label>Dia Vencimento</label><input type="number" id="cf-vencimento" min="1" max="31"></div>
            <div><label>Categoria</label>
              <select id="cf-categoria">
                <option>Moradia</option>
                <option>Serviços</option>
                <option>Educação</option>
                <option>Saúde</option>
                <option>Outros</option>
              </select>
            </div>
            <div><label>Recorrência</label>
              <select id="cf-recorrencia">
                <option value="mensal">Mensal (Tanto para este quanto p/ próximos meses)</option>
                <option value="pontual">Pontual (Apenas neste mês)</option>
              </select>
            </div>
          </div>
          <button class="btn" id="btn-add-conta">Cadastrar Conta Fixa</button>
        </div>
      </div>

      <div class="card">
        <h3>Resumo do Mês (${selectedMonth})</h3>
        <div class="grid grid-3" id="cf-resumo-grid"></div>
      </div>

      <div class="card">
        <h3>Minhas Contas Fixas</h3>
        <div id="lista-contas"></div>
      </div>

      <div id="modal-edit-container"></div>
    `;

    const monthSelector = renderMonthSelector(selectedMonth, (newMonth) => {
      selectedMonth = newMonth;
      renderView();
    });
    container.querySelector('#month-selector-container').appendChild(monthSelector);
    setupFormToggleListeners(container);

    // Event listener add
    container.querySelector('#btn-add-conta').addEventListener('click', async () => {
      const nome = container.querySelector('#cf-nome').value.trim();
      const valor = parseFloat(container.querySelector('#cf-valor').value) || 0;
      const diaVencimento = parseInt(container.querySelector('#cf-vencimento').value, 10) || 1;
      const categoria = container.querySelector('#cf-categoria').value;
      const recorrencia = container.querySelector('#cf-recorrencia').value;

      if (!nome) return alert('Preencha o nome da conta');

      await addDoc(contasCol, {
        nome,
        valor,
        diaVencimento,
        categoria,
        recorrencia,
        mesCriacao: selectedMonth
      });

      container.querySelector('#cf-nome').value = '';
      container.querySelector('#cf-valor').value = '';
    });

    // Subscriptions
    let contasData = [];
    let baixasData = [];

    function updateListAndSummary() {
      // Filtrar contas que se aplicam ao mês selecionado
      const ativasNoMes = contasData.filter(c => {
        if (c.recorrencia === 'pontual') {
          return c.mesCriacao === selectedMonth;
        }
        // mensal
        return !c.mesCriacao || c.mesCriacao <= selectedMonth;
      });

      const baixasDoMes = baixasData.filter(b => b.mes === selectedMonth);

      let totalGeral = 0;
      let totalPago = 0;
      let totalPendente = 0;

      const htmlRows = ativasNoMes.map(c => {
        const baixa = baixasDoMes.find(b => b.contaId === c.id);
        const estaPago = !!baixa;
        const valorEfetivo = baixa ? (baixa.valorEfetivo || c.valor) : c.valor;

        totalGeral += valorEfetivo;
        if (estaPago) totalPago += valorEfetivo;
        else totalPendente += valorEfetivo;

        return `
          <tr class="${estaPago ? 'riscado' : ''}">
            <td><strong>${c.nome}</strong></td>
            <td>Dia ${c.diaVencimento}</td>
            <td><span class="tag">${c.categoria}</span></td>
            <td><span class="tag">${c.recorrencia || 'mensal'}</span></td>
            <td>${formatBRL(valorEfetivo)}</td>
            <td>
              ${estaPago 
                ? `<button class="btn-ghost" data-unpay="${c.id}" style="color:var(--olive)">✓ Pago (${baixa.dataPagamento ? baixa.dataPagamento : 'Desfazer'})</button>`
                : `<button class="btn" data-pay="${c.id}">Marcar Pago</button>`
              }
            </td>
            <td>
              <button class="btn-ghost" data-edit="${c.id}">Editar</button>
              <button class="btn-danger" data-del="${c.id}">Excluir</button>
            </td>
          </tr>
        `;
      }).join('');

      container.querySelector('#cf-resumo-grid').innerHTML = `
        <div class="ledger-figure">
          <div class="value">${formatBRL(totalGeral)}</div>
          <div class="label">Total Previsto</div>
        </div>
        <div class="ledger-figure">
          <div class="value" style="color:var(--olive)">${formatBRL(totalPago)}</div>
          <div class="label">Total Pago</div>
        </div>
        <div class="ledger-figure">
          <div class="value" style="color:var(--terracota)">${formatBRL(totalPendente)}</div>
          <div class="label">Pendente</div>
        </div>
      `;

      const listEl = container.querySelector('#lista-contas');
      if (!ativasNoMes.length) {
        listEl.innerHTML = '<div class="empty-state">Nenhuma conta fixa cadastrada para este mês.</div>';
      } else {
        listEl.innerHTML = `
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Vencimento</th>
                  <th>Categoria</th>
                  <th>Recorrência</th>
                  <th>Valor</th>
                  <th>Status (${selectedMonth})</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>${htmlRows}</tbody>
            </table>
          </div>
        `;

        // Eventos
        listEl.querySelectorAll('[data-pay]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const contaId = btn.dataset.pay;
            const conta = contasData.find(c => c.id === contaId);
            const valorReal = prompt('Valor pago:', conta.valor);
            if (valorReal === null) return;
            
            await addDoc(baixasCol, {
              contaId,
              mes: selectedMonth,
              valorEfetivo: parseFloat(valorReal) || conta.valor,
              dataPagamento: new Date().toLocaleDateString('pt-BR')
            });
          });
        });

        listEl.querySelectorAll('[data-unpay]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const contaId = btn.dataset.unpay;
            const baixa = baixasDoMes.find(b => b.contaId === contaId);
            if (baixa) await deleteDoc(doc(db, 'contasFixasBaixas', baixa.id));
          });
        });

        listEl.querySelectorAll('[data-del]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (confirm('Excluir esta conta fixa?')) {
              await deleteDoc(doc(db, 'contasFixas', btn.dataset.del));
            }
          });
        });

        listEl.querySelectorAll('[data-edit]').forEach(btn => {
          btn.addEventListener('click', () => {
            const conta = contasData.find(c => c.id === btn.dataset.edit);
            openEditModal(conta);
          });
        });
      }
    }

    const unsubContas = onSnapshot(query(contasCol), (snap) => {
      contasData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateListAndSummary();
    });

    const unsubBaixas = onSnapshot(query(baixasCol), (snap) => {
      baixasData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateListAndSummary();
    });

    unsubs.push(unsubContas, unsubBaixas);
  }

  function openEditModal(conta) {
    const modalContainer = container.querySelector('#modal-edit-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-content">
          <h3>Editar Conta Fixa</h3>
          <label>Nome</label>
          <input type="text" id="edit-cf-nome" value="${conta.nome}">
          <label>Valor Padrão</label>
          <input type="number" step="0.01" id="edit-cf-valor" value="${conta.valor}">
          <label>Dia Vencimento</label>
          <input type="number" id="edit-cf-vencimento" value="${conta.diaVencimento}">
          <label>Categoria</label>
          <select id="edit-cf-categoria">
            <option ${conta.categoria === 'Moradia' ? 'selected' : ''}>Moradia</option>
            <option ${conta.categoria === 'Serviços' ? 'selected' : ''}>Serviços</option>
            <option ${conta.categoria === 'Educação' ? 'selected' : ''}>Educação</option>
            <option ${conta.categoria === 'Saúde' ? 'selected' : ''}>Saúde</option>
            <option ${conta.categoria === 'Outros' ? 'selected' : ''}>Outros</option>
          </select>
          <label>Recorrência</label>
          <select id="edit-cf-recorrencia">
            <option value="mensal" ${conta.recorrencia === 'mensal' ? 'selected' : ''}>Mensal</option>
            <option value="pontual" ${conta.recorrencia === 'pontual' ? 'selected' : ''}>Pontual</option>
          </select>
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
      await updateDoc(doc(db, 'contasFixas', conta.id), {
        nome: modalContainer.querySelector('#edit-cf-nome').value,
        valor: parseFloat(modalContainer.querySelector('#edit-cf-valor').value) || 0,
        diaVencimento: parseInt(modalContainer.querySelector('#edit-cf-vencimento').value) || 1,
        categoria: modalContainer.querySelector('#edit-cf-categoria').value,
        recorrencia: modalContainer.querySelector('#edit-cf-recorrencia').value
      });
      modalContainer.innerHTML = '';
    });
  }

  renderView();
  return unsubs;
}
