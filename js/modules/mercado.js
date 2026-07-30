import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, formatDate, todayISO, daysBetween, uid, currentMonthRef,
  monthRefFromDate, monthPickerHTML, wireMonthPicker, formatCartao, formatConta,
  collapsibleHeaderHTML, wireCollapsible
} from '../helpers.js';
import { getCartoes, upsertLancamentoEspelho, removerLancamentoEspelho } from './cartao.js';
import { getContas } from './renda.js';
import { ajustarSaldoConta } from '../saldoService.js';

const comprasCol = collection(db, 'mercadoCompras');
const despensaCol = collection(db, 'despensaItens');
const listaComprasCol = collection(db, 'listaCompras');

const CATEGORIAS = ['Limpeza', 'Higiene', 'Alimentos', 'Bebidas', 'Hortifruti', 'Açougue', 'Padaria', 'Pet', 'Outros'];
const UNIDADES = ['un', 'kg', 'litro', 'pacote'];

// ==================== SUBMÓDULO: COMPRA ====================
export async function renderMercadoCompra(container) {
  const unsubs = [];
  const cartoes = await getCartoes();
  const contasDisponiveis = await getContas();
  let itensTemp = [{ id: uid() }];
  let mes = currentMonthRef();
  let editandoId = null;
  let edicaoOriginal = null;

  container.innerHTML = `
    <h2 class="module-title">Mercado · Compra</h2>

    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-compra-body', 'Nova compra')}
      <div id="form-compra-body" class="collapsible-body collapsed">
        <div id="editando-aviso" style="display:none; color:var(--gold); font-size:13px; margin-bottom:10px"></div>
        <div class="grid grid-4" style="margin-top:12px">
          <div><label>Data</label><input type="date" id="m-data" value="${todayISO()}"></div>
          <div><label>Mercado</label><input type="text" id="m-mercado" placeholder="Ex: Extra"></div>
          <div><label>Modalidade</label>
            <select id="m-modalidade">
              <option value="presencial">Presencial</option>
              <option value="online">Online (iFood)</option>
            </select>
          </div>
          <div id="m-taxa-wrap" class="conditional">
            <label>Taxa de entrega</label><input type="number" step="0.01" id="m-taxa">
          </div>
          <div><label>Forma de pagamento</label>
            <select id="m-forma-pagamento">
              <option value="dinheiro">Dinheiro</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
              <option value="pix">Pix</option>
              <option value="vale">Vale Alimentação</option>
            </select>
          </div>
          <div id="m-cartao-wrap" class="conditional">
            <label>Qual cartão</label>
            <select id="m-cartao">${cartoes.map(c => `<option value="${c.id}">${formatCartao(c)}</option>`).join('')}</select>
          </div>
          <div id="m-parcelado-wrap" class="conditional">
            <label>Parcelado?</label>
            <select id="m-parcelado"><option value="nao">Não</option><option value="sim">Sim</option></select>
          </div>
          <div id="m-parcelas-wrap" class="conditional">
            <label>Número de parcelas</label><input type="number" id="m-parcelas" min="2">
          </div>
          <div id="m-vale-titular-wrap" class="conditional">
            <label>De quem é o vale</label>
            <select id="m-vale-titular"><option>Natasha</option><option>Daniel</option></select>
          </div>
          <div id="m-conta-saida-wrap" class="conditional">
            <label>Conta de saída</label>
            <select id="m-conta-saida">
              <option value="">Selecione a conta</option>
              ${contasDisponiveis.map(c => `<option value="${c.id}">${formatConta(c)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="card" style="margin:16px 0">
        <h3>Escanear cupom (IA)</h3>
        <p style="color:var(--text-dim); font-size:13px; margin-top:0">Tire uma foto do cupom fiscal ou nota — a IA tenta preencher os itens abaixo. Revise sempre antes de salvar.</p>
        <input type="file" id="input-foto-cupom" accept="image/*" capture="environment" style="display:none">
        <button class="btn-ghost" id="btn-escanear-cupom">📷 Tirar foto / escolher imagem</button>
        <span id="scan-status" style="margin-left:12px; color:var(--text-dim); font-size:13px"></span>
      </div>

      <h3>Itens</h3>
      <div id="itens-lista" style="margin-top:16px"></div>
      <button class="btn-ghost" id="btn-add-item" style="margin-top:8px">+ Adicionar item</button>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; border-top:1px solid var(--border); padding-top:16px">
        <div>
          <div class="label" style="color:var(--text-dim); font-size:12px; text-transform:uppercase">Valor total</div>
          <div class="display" style="font-size:24px; color:var(--gold)" id="m-total-display">R$ 0,00</div>
        </div>
        <div style="display:flex; gap:8px">
          <button class="btn-ghost" id="btn-cancelar-edicao" style="display:none">Cancelar edição</button>
          <button class="btn" id="btn-salvar-compra">Salvar compra</button>
        </div>
      </div>
    </div>

    ${'<div id="mp-slot">' + monthPickerHTML(mes) + '</div>'}
    <div id="historico-compras"></div>
  `;
  wireCollapsible(container);
  function refreshMonthPicker() {
    document.getElementById('mp-slot').innerHTML = monthPickerHTML(mes);
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; refreshMonthPicker(); carregarHistorico(); });
  }
  refreshMonthPicker();

  document.getElementById('m-modalidade').addEventListener('change', (e) => {
    document.getElementById('m-taxa-wrap').classList.toggle('show', e.target.value === 'online');
  });
  document.getElementById('m-forma-pagamento').addEventListener('change', (e) => {
    const isCredito = e.target.value === 'credito';
    const isVale = e.target.value === 'vale';
    const isAVista = ['dinheiro', 'debito', 'pix'].includes(e.target.value);
    document.getElementById('m-cartao-wrap').classList.toggle('show', isCredito);
    document.getElementById('m-parcelado-wrap').classList.toggle('show', isCredito);
    document.getElementById('m-vale-titular-wrap').classList.toggle('show', isVale);
    document.getElementById('m-conta-saida-wrap').classList.toggle('show', isAVista);
    if (!isCredito) document.getElementById('m-parcelas-wrap').classList.remove('show');
  });
  document.getElementById('m-parcelado').addEventListener('change', (e) => {
    document.getElementById('m-parcelas-wrap').classList.toggle('show', e.target.value === 'sim');
  });

  document.getElementById('btn-escanear-cupom').addEventListener('click', () => {
    document.getElementById('input-foto-cupom').click();
  });
  document.getElementById('input-foto-cupom').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('scan-status');
    status.textContent = 'Lendo cupom, aguarde...';
    try {
      const { base64, mimeType } = await comprimirImagem(file);
      const resp = await fetch('/api/scan-cupom', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType })
      });
      const resultado = await resp.json();
      if (!resp.ok) { status.textContent = 'Não consegui ler o cupom. Preencha manualmente.'; return; }
      if (resultado.mercado && !document.getElementById('m-mercado').value) {
        document.getElementById('m-mercado').value = resultado.mercado;
      }
      if (Array.isArray(resultado.itens) && resultado.itens.length) {
        itensTemp = resultado.itens.map(item => ({
          id: uid(), nome: item.nome || '', quantidade: item.quantidade ?? '',
          precoUnitario: item.precoUnitario ?? '', lidoPorIA: true
        }));
        renderItensLista();
        status.textContent = `${resultado.itens.length} item(ns) lido(s). Revise antes de salvar.`;
      } else {
        status.textContent = 'A IA não encontrou itens legíveis nessa foto.';
      }
    } catch (err) {
      status.textContent = 'Erro ao processar a imagem.';
    }
    e.target.value = '';
  });

  function comprimirImagem(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1400;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width *= scale; height *= scale;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  renderItensLista();
  document.getElementById('btn-add-item').addEventListener('click', () => {
    itensTemp.push({ id: uid() });
    renderItensLista();
  });
  document.getElementById('btn-salvar-compra').addEventListener('click', salvarCompra);
  document.getElementById('btn-cancelar-edicao').addEventListener('click', () => resetForm());

  function renderItensLista() {
    const el = document.getElementById('itens-lista');
    el.innerHTML = `
      <div class="item-row" style="font-size:11px; color:var(--text-dim); text-transform:uppercase">
        <span>Item (nome genérico)</span><span>Marca (opcional)</span><span>Categoria</span><span>Qtd / Un.</span><span>Preço unit.</span><span></span>
      </div>
      ${itensTemp.map(item => `
      <div class="item-row" data-item-id="${item.id}">
        <div style="display:flex; align-items:center; gap:6px">
          <input type="text" class="i-nome" placeholder="Ex: Detergente" value="${item.nome || ''}">
          ${item.lidoPorIA ? '<span class="tag" title="Preenchido pela IA, revise">IA</span>' : ''}
        </div>
        <input type="text" class="i-marca" placeholder="Ex: Ypê" value="${item.marca || ''}">
        <select class="i-categoria">${CATEGORIAS.map(c => `<option ${item.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <div style="display:flex; gap:4px">
          <input type="number" class="i-qtd" placeholder="Qtd" style="width:60px" value="${item.quantidade ?? ''}">
          <select class="i-unidade">${UNIDADES.map(u => `<option ${item.unidade === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
        </div>
        <input type="number" step="0.01" class="i-preco" placeholder="0,00" value="${item.precoUnitario ?? ''}">
        <button class="btn-danger" data-remove-item="${item.id}">×</button>
      </div>
    `).join('')}`;

    el.querySelectorAll('[data-remove-item]').forEach(btn => {
      btn.addEventListener('click', () => {
        itensTemp = itensTemp.filter(i => i.id !== btn.dataset.removeItem);
        renderItensLista();
      });
    });
    el.querySelectorAll('.i-qtd, .i-preco').forEach(inp => inp.addEventListener('input', atualizarTotal));
    atualizarTotal();
  }

  function atualizarTotal() {
    let total = 0;
    document.querySelectorAll('[data-item-id]').forEach(row => {
      const qtd = parseFloat(row.querySelector('.i-qtd').value) || 0;
      const preco = parseFloat(row.querySelector('.i-preco').value) || 0;
      total += qtd * preco;
    });
    const taxa = parseFloat(document.getElementById('m-taxa')?.value) || 0;
    total += taxa;
    document.getElementById('m-total-display').textContent = formatBRL(total);
  }

  function resetForm() {
    editandoId = null;
    edicaoOriginal = null;
    itensTemp = [{ id: uid() }];
    document.getElementById('editando-aviso').style.display = 'none';
    document.getElementById('btn-cancelar-edicao').style.display = 'none';
    document.getElementById('btn-salvar-compra').textContent = 'Salvar compra';
    document.getElementById('m-data').value = todayISO();
    document.getElementById('m-mercado').value = '';
    renderItensLista();
  }

  async function carregarParaEdicao(compra) {
    editandoId = compra.id;
    edicaoOriginal = {
      contaSaidaId: compra.contaSaidaId || null,
      valorTotal: compra.valorTotal || 0
    };
    document.getElementById('editando-aviso').style.display = 'block';
    document.getElementById('editando-aviso').textContent = `Editando compra de ${formatDate(compra.data)} em ${compra.mercado}`;
    document.getElementById('btn-cancelar-edicao').style.display = 'inline-block';
    document.getElementById('btn-salvar-compra').textContent = 'Atualizar compra';
    document.getElementById('form-compra-body').classList.remove('collapsed');

    document.getElementById('m-data').value = compra.data;
    document.getElementById('m-mercado').value = compra.mercado;
    document.getElementById('m-modalidade').value = compra.modalidade;
    document.getElementById('m-taxa-wrap').classList.toggle('show', compra.modalidade === 'online');
    if (compra.taxaEntrega) document.getElementById('m-taxa').value = compra.taxaEntrega;
    document.getElementById('m-forma-pagamento').value = compra.formaPagamento;
    const isAVistaEdit = ['dinheiro', 'debito', 'pix'].includes(compra.formaPagamento);
    document.getElementById('m-cartao-wrap').classList.toggle('show', compra.formaPagamento === 'credito');
    document.getElementById('m-parcelado-wrap').classList.toggle('show', compra.formaPagamento === 'credito');
    document.getElementById('m-vale-titular-wrap').classList.toggle('show', compra.formaPagamento === 'vale');
    document.getElementById('m-conta-saida-wrap').classList.toggle('show', isAVistaEdit);
    if (compra.cartaoId) document.getElementById('m-cartao').value = compra.cartaoId;
    if (compra.contaSaidaId) document.getElementById('m-conta-saida').value = compra.contaSaidaId;
    if (compra.parcelado) {
      document.getElementById('m-parcelado').value = 'sim';
      document.getElementById('m-parcelas-wrap').classList.add('show');
      document.getElementById('m-parcelas').value = compra.numParcelas;
    }
    if (compra.valeTitular) document.getElementById('m-vale-titular').value = compra.valeTitular;

    itensTemp = (compra.itens || []).map(i => ({ id: uid(), ...i }));
    renderItensLista();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function salvarCompra() {
    const data = document.getElementById('m-data').value;
    const mercado = document.getElementById('m-mercado').value || 'Não informado';
    const modalidade = document.getElementById('m-modalidade').value;
    const taxaEntrega = modalidade === 'online' ? (parseFloat(document.getElementById('m-taxa').value) || 0) : 0;
    const formaPagamento = document.getElementById('m-forma-pagamento').value;
    const cartaoId = formaPagamento === 'credito' ? document.getElementById('m-cartao').value : null;
    const parcelado = formaPagamento === 'credito' && document.getElementById('m-parcelado').value === 'sim';
    const numParcelas = parcelado ? (parseInt(document.getElementById('m-parcelas').value) || 1) : 1;
    const valeTitular = formaPagamento === 'vale' ? document.getElementById('m-vale-titular').value : null;
    const isAVista = ['dinheiro', 'debito', 'pix'].includes(formaPagamento);
    const contaSaidaId = isAVista ? document.getElementById('m-conta-saida').value : null;
    if (isAVista && !contaSaidaId) { alert('Selecione de qual conta essa compra saiu.'); return; }

    const itens = [];
    document.querySelectorAll('[data-item-id]').forEach(row => {
      const nome = row.querySelector('.i-nome').value;
      if (!nome) return;
      const qtd = parseFloat(row.querySelector('.i-qtd').value) || 0;
      const preco = parseFloat(row.querySelector('.i-preco').value) || 0;
      itens.push({
        nome, marca: row.querySelector('.i-marca').value || null,
        categoria: row.querySelector('.i-categoria').value,
        quantidade: qtd, unidade: row.querySelector('.i-unidade').value,
        precoUnitario: preco, precoTotal: qtd * preco
      });
    });
    if (!itens.length) { alert('Adicione pelo menos um item.'); return; }
    const valorTotal = itens.reduce((s, i) => s + i.precoTotal, 0) + taxaEntrega;
    const payload = { data, mercado, modalidade, taxaEntrega, formaPagamento, cartaoId, parcelado, numParcelas, valeTitular, contaSaidaId, valorTotal, itens };

    let compraId;
    if (editandoId) {
      compraId = editandoId;
      await updateDoc(doc(db, 'mercadoCompras', compraId), payload);
      if (edicaoOriginal && edicaoOriginal.contaSaidaId) {
        await ajustarSaldoConta(edicaoOriginal.contaSaidaId, edicaoOriginal.valorTotal);
      }
    } else {
      const ref = await addDoc(comprasCol, payload);
      compraId = ref.id;
      // Todo item comprado vai automaticamente para a Despensa
      for (const item of itens) {
        await addDoc(despensaCol, {
          nome: item.nome, marca: item.marca, categoria: item.categoria, compraId,
          dataInicio: data, dataFim: null, emUso: true
        });
      }
    }

    if (formaPagamento === 'credito') {
      await upsertLancamentoEspelho({
        origem: 'mercado', origemId: compraId, cartaoId, valorTotal, parcelado, numParcelas, data,
        descricao: `Compra de mercado (${mercado})`, categoria: 'Mercado'
      });
    } else {
      await removerLancamentoEspelho('mercado', compraId);
    }

    if (contaSaidaId) {
      const novoSaldo = await ajustarSaldoConta(contaSaidaId, -valorTotal);
      if (novoSaldo !== null && novoSaldo < 0) {
        alert('Compra registrada. Atenção: o saldo dessa conta ficou negativo.');
      }
    }

    alert(editandoId ? 'Compra atualizada!' : 'Compra salva com sucesso!');
    resetForm();
    carregarHistorico();
  }

  let unsubHistorico = null;
  function carregarHistorico() {
    if (unsubHistorico) unsubHistorico();
    unsubHistorico = onSnapshot(query(comprasCol), (snap) => {
      const compras = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(c => monthRefFromDate(c.data) === mes)
        .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
      const el = document.getElementById('historico-compras');
      if (!compras.length) {
        el.innerHTML = '<div class="empty-state">Nenhuma compra registrada nesse mês.</div>';
        return;
      }
      el.innerHTML = `
        <table>
          <thead><tr><th>Data</th><th>Mercado</th><th>Modalidade</th><th>Pagamento</th><th>Valor</th><th></th></tr></thead>
          <tbody>
            ${compras.map(c => `
              <tr>
                <td>${formatDate(c.data)}</td>
                <td>${c.mercado}</td>
                <td>${c.modalidade === 'online' ? 'Online (iFood)' : 'Presencial'}</td>
                <td>${c.formaPagamento}</td>
                <td>${formatBRL(c.valorTotal)}</td>
                <td>
                  <button class="btn-ghost" data-edit="${c.id}">Editar</button>
                  <button class="btn-danger" data-del="${c.id}">Excluir</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      el.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
          const compra = compras.find(c => c.id === btn.dataset.edit);
          carregarParaEdicao(compra);
        });
      });
      el.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Excluir esta compra?')) return;
          const compra = compras.find(c => c.id === btn.dataset.del);
          if (compra && compra.contaSaidaId) {
            await ajustarSaldoConta(compra.contaSaidaId, compra.valorTotal);
          }
          await deleteDoc(doc(db, 'mercadoCompras', btn.dataset.del));
          await removerLancamentoEspelho('mercado', btn.dataset.del);
        });
      });
    });
    unsubs.push(() => { if (unsubHistorico) unsubHistorico(); });
  }

  carregarHistorico();
  return unsubs;
}


// ==================== SUBMÓDULO: DESPENSA ====================
export function renderMercadoDespensa(container) {
  const unsubs = [];

  container.innerHTML = `
    <h2 class="module-title">Mercado · Despensa</h2>
    <p style="color:var(--text-dim); font-size:13px; margin-bottom:16px">
      Todo item comprado no Mercado entra aqui automaticamente. Itens com o mesmo nome são agrupados (a marca fica como detalhe).
      A lista de compras só recebe um item quando você clicar em "Incluir na lista" — a data fim não adiciona nada sozinha.
    </p>
    <div id="lista-despensa"></div>
  `;

  const unsub = onSnapshot(query(despensaCol), (snap) => {
    const itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Agrupa por nome (case-insensitive, sem espaços nas pontas)
    const grupos = {};
    itens.forEach(i => {
      const chave = (i.nome || '').trim().toLowerCase();
      if (!grupos[chave]) grupos[chave] = { nome: i.nome, categoria: i.categoria, instancias: [] };
      grupos[chave].instancias.push(i);
    });
    const listaGrupos = Object.values(grupos).sort((a, b) => a.nome.localeCompare(b.nome));

    const el = document.getElementById('lista-despensa');
    if (!listaGrupos.length) {
      el.innerHTML = '<div class="empty-state">Nenhum item na despensa ainda. Itens de novas compras aparecem aqui automaticamente.</div>';
      return;
    }

    el.innerHTML = listaGrupos.map(g => {
      const emUsoCount = g.instancias.filter(i => i.emUso).length;
      return `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <div>
            <h3 style="margin-bottom:2px">${g.nome}</h3>
            <span class="tag">${g.categoria}</span>
          </div>
          <div class="display" style="color:var(--gold); font-size:22px">${emUsoCount} em uso</div>
        </div>
        <table style="margin-top:12px">
          <thead><tr><th>Marca</th><th>Início</th><th>Fim</th><th>Em uso</th><th></th></tr></thead>
          <tbody>
            ${g.instancias.map(i => `
              <tr>
                <td>${i.marca || '—'}</td>
                <td><input type="date" class="input-data-inicio" data-id="${i.id}" value="${i.dataInicio || ''}" style="margin-bottom:0; width:150px"></td>
                <td><input type="date" class="input-data-fim" data-id="${i.id}" value="${i.dataFim || ''}" style="margin-bottom:0; width:150px"></td>
                <td><button class="btn-ghost" data-toggle-uso="${i.id}">${i.emUso ? 'Em uso: Sim' : 'Em uso: Não'}</button></td>
                <td><button class="btn-ghost" data-incluir-lista="${i.id}">Incluir na lista de compras</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    }).join('');

    el.querySelectorAll('.input-data-inicio').forEach(inp => {
      inp.addEventListener('change', async () => {
        await updateDoc(doc(db, 'despensaItens', inp.dataset.id), { dataInicio: inp.value || null });
      });
    });
    el.querySelectorAll('.input-data-fim').forEach(inp => {
      inp.addEventListener('change', async () => {
        await updateDoc(doc(db, 'despensaItens', inp.dataset.id), { dataFim: inp.value || null });
      });
    });
    el.querySelectorAll('[data-toggle-uso]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = itens.find(i => i.id === btn.dataset.toggleUso);
        const novoEmUso = !item.emUso;
        const patch = { emUso: novoEmUso };
        // Se marcar como "não em uso" e ainda não tiver data fim, sugere hoje (editável depois)
        if (!novoEmUso && !item.dataFim) patch.dataFim = todayISO();
        await updateDoc(doc(db, 'despensaItens', item.id), patch);
      });
    });
    el.querySelectorAll('[data-incluir-lista]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = itens.find(i => i.id === btn.dataset.incluirLista);
        await addDoc(listaComprasCol, {
          tipo: 'auto', nome: item.nome, categoria: item.categoria, comprado: false, criadoEm: todayISO()
        });
        alert(`"${item.nome}" incluído na lista de compras.`);
      });
    });
  });
  unsubs.push(unsub);
  return unsubs;
}

// ==================== SUBMÓDULO: LISTA DE COMPRAS ====================
export function renderMercadoLista(container) {
  const unsubs = [];

  container.innerHTML = `
    <h2 class="module-title">Mercado · Lista de compras</h2>
    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-livre-body', 'Adicionar item livre')}
      <div id="form-livre-body" class="collapsible-body collapsed">
        <div style="display:flex; gap:8px; margin-top:12px">
          <input type="text" id="livre-nome" placeholder="Nome do item" style="margin-bottom:0">
          <button class="btn" id="btn-add-livre">Adicionar</button>
        </div>
      </div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h3>Itens que acabaram (automático)</h3>
        <div id="lista-auto" style="margin-top:12px"></div>
      </div>
      <div class="card">
        <h3>Itens adicionados manualmente</h3>
        <div id="lista-livre" style="margin-top:12px"></div>
      </div>
    </div>
    <div style="margin-top:16px; text-align:right">
      <button class="btn-ghost" id="btn-limpar-lista">Limpar itens comprados</button>
    </div>
  `;
  wireCollapsible(container);

  document.getElementById('btn-add-livre').addEventListener('click', async () => {
    const input = document.getElementById('livre-nome');
    if (!input.value) return;
    await addDoc(listaComprasCol, { tipo: 'livre', nome: input.value, categoria: 'Outros', comprado: false, criadoEm: todayISO() });
    input.value = '';
  });

  const unsub = onSnapshot(query(listaComprasCol), (snap) => {
    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSecao('lista-auto', todos.filter(i => i.tipo === 'auto'));
    renderSecao('lista-livre', todos.filter(i => i.tipo === 'livre'));
  });
  unsubs.push(unsub);

  document.getElementById('btn-limpar-lista').addEventListener('click', async () => {
    const snap = await new Promise(res => { const u = onSnapshot(query(listaComprasCol), s => { res(s); u(); }); });
    const comprados = snap.docs.filter(d => d.data().comprado);
    for (const d of comprados) await deleteDoc(doc(db, 'listaCompras', d.id));
  });

  function renderSecao(elId, itens) {
    const el = document.getElementById(elId);
    if (!itens.length) {
      el.innerHTML = '<div class="empty-state">Nada por aqui.</div>';
      return;
    }
    el.innerHTML = itens.map(i => `
      <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border); ${i.comprado ? 'text-decoration:line-through; color:var(--text-dim)' : ''}">
        <input type="checkbox" data-toggle="${i.id}" ${i.comprado ? 'checked' : ''}>
        <span style="flex:1">${i.nome}</span>
        <span class="tag">${i.categoria}</span>
      </div>
    `).join('');
    el.querySelectorAll('[data-toggle]').forEach(chk => {
      chk.addEventListener('change', async () => {
        await updateDoc(doc(db, 'listaCompras', chk.dataset.toggle), { comprado: chk.checked });
      });
    });
  }

  return unsubs;
}
