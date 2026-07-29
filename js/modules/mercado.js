import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, formatDate, todayISO, currentMonthRef, monthRefFromDate, renderMonthSelector, renderFormToggleHeader, setupFormToggleListeners } from '../helpers.js';
import { getCartoesFormated, upsertLancamentoDeMercado, removerLancamentoDeMercado } from './cartao.js';

const comprasCol = collection(db, 'mercadoCompras');
const estoqueCol = collection(db, 'mercadoEstoque');
const listaCol = collection(db, 'mercadoLista');

export async function renderMercadoCompra(container) {
  const unsubs = [];
  let selectedMonth = currentMonthRef();
  let cartoes = await getCartoesFormated();

  function renderView() {
    container.innerHTML = `
      <h2 class="module-title">Mercado - Registras Compras</h2>
      <div id="month-selector-container"></div>

      <div class="card">
        ${renderFormToggleHeader('Cadastrar Nova Compra de Mercado', 'form-add-compra')}
        <div id="form-add-compra">
          <div class="grid grid-3">
            <div><label>Nome do Mercado</label><input type="text" id="m-mercado" placeholder="Ex: Carrefour, Festval"></div>
            <div><label>Data da Compra</label><input type="date" id="m-data" value="${todayISO()}"></div>
            <div><label>Forma de Pagamento</label>
              <select id="m-forma">
                <option value="vale">Vale Alimentação (Natasha)</option>
                <option value="credito">Cartão de Crédito</option>
                <option value="pix">PIX / Débito</option>
                <option value="dinheiro">Dinheiro</option>
              </select>
            </div>
            <div id="m-cartao-wrap" class="conditional">
              <label>Selecione o Cartão</label>
              <select id="m-cartao-id">
                <option value="">Selecione...</option>
                ${cartoes.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="margin:16px 0; padding:12px; background:var(--surface-2); border-radius:6px;">
            <label><strong>Escanear Nota Fiscal com IA Gemini</strong></label>
            <input type="file" id="m-scan-file" accept="image/*" style="margin-bottom:8px">
            <button class="btn-ghost" id="m-btn-scan">Escanear Cupom</button>
            <span id="m-scan-status" style="font-size:13px; color:var(--text-dim); margin-left:10px;"></span>
          </div>

          <h4>Itens Comprados</h4>
          <div id="m-itens-container"></div>
          <button class="btn-ghost" id="btn-add-item-row" style="margin-bottom:16px">+ Adicionar Item Manualmente</button>

          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:12px;">
            <h3>Total: <span id="m-valor-total">R$ 0,00</span></h3>
            <button class="btn" id="btn-salvar-compra">Salvar Compra de Mercado</button>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Histórico de Compras (${selectedMonth})</h3>
        <div id="lista-compras-mercado"></div>
      </div>

      <div id="modal-edit-container"></div>
    `;

    const monthSelector = renderMonthSelector(selectedMonth, (newMonth) => {
      selectedMonth = newMonth;
      renderView();
    });
    container.querySelector('#month-selector-container').appendChild(monthSelector);
    setupFormToggleListeners(container);

    const formaSel = container.querySelector('#m-forma');
    const cartaoWrap = container.querySelector('#m-cartao-wrap');
    formaSel.addEventListener('change', () => {
      cartaoWrap.classList.toggle('show', formaSel.value === 'credito');
    });

    const itensContainer = container.querySelector('#m-itens-container');

    function addItemRow(nome = '', qtd = 1, precoUnit = 0) {
      const row = document.createElement('div');
      row.className = 'item-row';
      row.innerHTML = `
        <input type="text" placeholder="Nome do item" class="item-nome" value="${nome}">
        <input type="number" placeholder="Qtd" class="item-qtd" value="${qtd}" min="0.1" step="any">
        <input type="number" placeholder="Preço Unit." class="item-preco" value="${precoUnit}" step="0.01">
        <span class="item-subtotal">${formatBRL(qtd * precoUnit)}</span>
        <button class="btn-danger btn-del-row">X</button>
      `;
      
      const calcRow = () => {
        const q = parseFloat(row.querySelector('.item-qtd').value) || 0;
        const p = parseFloat(row.querySelector('.item-preco').value) || 0;
        row.querySelector('.item-subtotal').textContent = formatBRL(q * p);
        calcTotal();
      };

      row.querySelector('.item-qtd').addEventListener('input', calcRow);
      row.querySelector('.item-preco').addEventListener('input', calcRow);
      row.querySelector('.btn-del-row').addEventListener('click', () => {
        row.remove();
        calcTotal();
      });

      itensContainer.appendChild(row);
      calcTotal();
    }

    function calcTotal() {
      let sum = 0;
      itensContainer.querySelectorAll('.item-row').forEach(row => {
        const q = parseFloat(row.querySelector('.item-qtd').value) || 0;
        const p = parseFloat(row.querySelector('.item-preco').value) || 0;
        sum += (q * p);
      });
      container.querySelector('#m-valor-total').textContent = formatBRL(sum);
      return sum;
    }

    addItemRow();

    container.querySelector('#btn-add-item-row').addEventListener('click', () => addItemRow());

    // IA Gemini scan
    container.querySelector('#m-btn-scan').addEventListener('click', async () => {
      const fileInput = container.querySelector('#m-scan-file');
      const statusEl = container.querySelector('#m-scan-status');

      if (!fileInput.files || !fileInput.files[0]) return alert('Selecione uma foto da nota fiscal!');

      statusEl.textContent = 'Lendo nota com Gemini IA...';
      const file = fileInput.files[0];

      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        try {
          const resp = await fetch('/api/scan-cupom.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64, mimeType: file.type })
          });
          const json = await resp.json();

          if (json.error) {
            statusEl.textContent = 'Erro ao ler cupom.';
            alert('Erro: ' + json.error);
            return;
          }

          statusEl.textContent = 'Nota lida com sucesso!';
          if (json.mercado) container.querySelector('#m-mercado').value = json.mercado;
          
          if (json.itens && json.itens.length) {
            itensContainer.innerHTML = '';
            json.itens.forEach(it => {
              addItemRow(it.nome || '', it.quantidade || 1, it.precoUnitario || 0);
            });
          }
        } catch (e) {
          statusEl.textContent = 'Erro de comunicação.';
          alert('Erro ao enviar imagem.');
        }
      };
      reader.readAsDataURL(file);
    });

    // Salvar Compra
    container.querySelector('#btn-salvar-compra').addEventListener('click', async () => {
      const mercado = container.querySelector('#m-mercado').value.trim() || 'Mercado General';
      const data = container.querySelector('#m-data').value;
      const formaPagamento = formaSel.value;
      const cartaoId = container.querySelector('#m-cartao-id').value;
      const valorTotal = calcTotal();

      const itens = [];
      itensContainer.querySelectorAll('.item-row').forEach(row => {
        const nome = row.querySelector('.item-nome').value.trim();
        const quantidade = parseFloat(row.querySelector('.item-qtd').value) || 0;
        const precoUnitario = parseFloat(row.querySelector('.item-preco').value) || 0;
        if (nome) {
          itens.push({ nome, quantidade, precoUnitario, precoTotal: quantidade * precoUnitario });
        }
      });

      if (!itens.length) return alert('Adicione pelo menos 1 item!');
      if (formaPagamento === 'credito' && !cartaoId) return alert('Selecione o cartão de crédito!');

      const docRef = await addDoc(comprasCol, {
        mercado,
        data,
        formaPagamento,
        cartaoId: formaPagamento === 'credito' ? cartaoId : null,
        valeTitular: formaPagamento === 'vale' ? 'Natasha' : null,
        valorTotal,
        itens
      });

      // Se for Cartão de Crédito -> espelhar no cartão
      if (formaPagamento === 'credito') {
        await upsertLancamentoDeMercado({
          mercadoCompraId: docRef.id,
          cartaoId,
          valorTotal,
          parcelado: false,
          numParcelas: 1,
          data
        });
      }

      // Adicionar itens ao estoque (em uso)
      for (const item of itens) {
        await addDoc(estoqueCol, {
          nome: item.nome,
          mercado,
          dataCompra: data,
          quantidade: item.quantidade,
          status: 'em_uso'
        });
      }

      alert('Compra de mercado salva e itens adicionados ao estoque!');
      container.querySelector('#m-mercado').value = '';
      itensContainer.innerHTML = '';
      addItemRow();
    });

    // Subscrição do histórico
    const unsub = onSnapshot(query(comprasCol), (snap) => {
      const todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const doMes = todas.filter(c => monthRefFromDate(c.data) === selectedMonth)
                        .sort((a, b) => b.data.localeCompare(a.data));

      const listEl = container.querySelector('#lista-compras-mercado');
      if (!doMes.length) {
        listEl.innerHTML = '<div class="empty-state">Nenhuma compra de mercado registrada neste mês.</div>';
      } else {
        const html = doMes.map(c => {
          const cartaoObj = cartoes.find(x => x.id === c.cartaoId);
          const pagInfo = c.formaPagamento === 'credito' && cartaoObj ? cartaoObj.label : c.formaPagamento;

          return `
            <div style="border-bottom:1px solid var(--border); padding:12px 0;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <strong>${c.mercado}</strong> - <span style="color:var(--text-dim)">${formatDate(c.data)}</span>
                  <div><span class="tag">${pagInfo}</span> <span class="tag">${c.itens ? c.itens.length : 0} itens</span></div>
                </div>
                <div>
                  <strong style="color:var(--gold); font-size:16px;">${formatBRL(c.valorTotal)}</strong>
                  <button class="btn-ghost" data-edit="${c.id}" style="margin-left:8px">Editar</button>
                  <button class="btn-danger" data-del="${c.id}">Excluir</button>
                </div>
              </div>
            </div>
          `;
        }).join('');

        listEl.innerHTML = html;

        listEl.querySelectorAll('[data-del]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (confirm('Excluir esta compra?')) {
              const id = btn.dataset.del;
              await deleteDoc(doc(db, 'mercadoCompras', id));
              await removerLancamentoDeMercado(id);
            }
          });
        });

        listEl.querySelectorAll('[data-edit]').forEach(btn => {
          btn.addEventListener('click', () => {
            const comp = doMes.find(x => x.id === btn.dataset.edit);
            openEditModal(comp);
          });
        });
      }
    });

    unsubs.push(unsub);
  }

  function openEditModal(compra) {
    const modalContainer = container.querySelector('#modal-edit-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-content">
          <h3>Editar Compra de Mercado</h3>
          <label>Mercado</label>
          <input type="text" id="edit-m-mercado" value="${compra.mercado}">
          <label>Data</label>
          <input type="date" id="edit-m-data" value="${compra.data}">
          <label>Valor Total (R$)</label>
          <input type="number" step="0.01" id="edit-m-valor" value="${compra.valorTotal}">
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
      const mercado = modalContainer.querySelector('#edit-m-mercado').value;
      const data = modalContainer.querySelector('#edit-m-data').value;
      const valorTotal = parseFloat(modalContainer.querySelector('#edit-m-valor').value) || 0;

      await updateDoc(doc(db, 'mercadoCompras', compra.id), { mercado, data, valorTotal });

      if (compra.formaPagamento === 'credito') {
        await upsertLancamentoDeMercado({
          mercadoCompraId: compra.id,
          cartaoId: compra.cartaoId,
          valorTotal,
          parcelado: false,
          numParcelas: 1,
          data
        });
      }

      modalContainer.innerHTML = '';
    });
  }

  renderView();
  return unsubs;
}

export async function renderMercadoEmUso(container) {
  const unsubs = [];
  container.innerHTML = `
    <h2 class="module-title">Mercado - Itens em Uso / Estoque</h2>
    <div class="card">
      <h3>Itens Atualmente em Casa</h3>
      <div id="lista-estoque"></div>
    </div>
  `;

  const unsub = onSnapshot(query(estoqueCol), (snap) => {
    const itens = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                           .filter(i => i.status === 'em_uso');

    const listEl = container.querySelector('#lista-estoque');
    if (!itens.length) {
      listEl.innerHTML = '<div class="empty-state">Nenhum item em estoque no momento.</div>';
      return;
    }

    listEl.innerHTML = `
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Origem</th>
              <th>Data Compra</th>
              <th>Qtd</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${itens.map(i => `
              <tr>
                <td><strong>${i.nome}</strong></td>
                <td>${i.mercado || '-'}</td>
                <td>${formatDate(i.dataCompra)}</td>
                <td>${i.quantidade}</td>
                <td>
                  <button class="btn-ghost" data-finish="${i.id}">Acabou (Mover p/ Lista)</button>
                  <button class="btn-danger" data-del="${i.id}">Remover</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    listEl.querySelectorAll('[data-finish]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.finish;
        const item = itens.find(x => x.id === id);
        await updateDoc(doc(db, 'mercadoEstoque', id), { status: 'finalizado' });
        await addDoc(listaCol, { nome: item.nome, checado: false });
      });
    });

    listEl.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover do estoque?')) await deleteDoc(doc(db, 'mercadoEstoque', btn.dataset.del));
      });
    });
  });

  unsubs.push(unsub);
  return unsubs;
}

export async function renderMercadoLista(container) {
  const unsubs = [];
  container.innerHTML = `
    <h2 class="module-title">Mercado - Lista de Compras</h2>
    <div class="card">
      ${renderFormToggleHeader('Adicionar Item à Lista', 'form-add-lista')}
      <div id="form-add-lista">
        <div style="display:flex; gap:8px;">
          <input type="text" id="l-item-nome" placeholder="Ex: Leite, Ovos, Pão" style="margin:0">
          <button class="btn" id="btn-add-lista">Adicionar</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Itens Pendentes</h3>
      <div id="lista-pendentes"></div>
    </div>
  `;

  setupFormToggleListeners(container);

  container.querySelector('#btn-add-lista').addEventListener('click', async () => {
    const nome = container.querySelector('#l-item-nome').value.trim();
    if (!nome) return;
    await addDoc(listaCol, { nome, checado: false });
    container.querySelector('#l-item-nome').value = '';
  });

  const unsub = onSnapshot(query(listaCol), (snap) => {
    const itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const listEl = container.querySelector('#lista-pendentes');
    if (!itens.length) {
      listEl.innerHTML = '<div class="empty-state">Sua lista de compras está vazia!</div>';
      return;
    }

    listEl.innerHTML = `
      <table>
        <tbody>
          ${itens.map(i => `
            <tr>
              <td><input type="checkbox" ${i.checado ? 'checked' : ''} data-check="${i.id}"></td>
              <td class="${i.checado ? 'riscado' : ''}"><strong>${i.nome}</strong></td>
              <td style="text-align:right"><button class="btn-danger" data-del="${i.id}">Remover</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    listEl.querySelectorAll('[data-check]').forEach(chk => {
      chk.addEventListener('change', async () => {
        await updateDoc(doc(db, 'mercadoLista', chk.dataset.check), { checado: chk.checked });
      });
    });

    listEl.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await deleteDoc(doc(db, 'mercadoLista', btn.dataset.del));
      });
    });
  });

  unsubs.push(unsub);
  return unsubs;
}
