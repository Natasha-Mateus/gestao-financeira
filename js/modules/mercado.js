import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, formatDate, todayISO, daysBetween, uid, currentMonthRef,
  monthRefFromDate, monthPickerHTML, wireMonthPicker, formatCartao, formatConta,
  collapsibleHeaderHTML, wireCollapsible, formatFormasPagamento
} from '../helpers.js';
import { getCartoes, upsertLancamentoEspelho, removerLancamentosEspelhoMercado } from './cartao.js';
import { getContas } from './renda.js';
import { ajustarSaldoConta } from '../saldoService.js';

const comprasCol = collection(db, 'mercadoCompras');
const despensaCol = collection(db, 'despensaItens');
const listaComprasCol = collection(db, 'listaCompras');

const UNIDADES = ['un', 'kg', 'litro', 'pacote'];

function chaveItem(nome, marca) {
  return `${(nome || '').trim().toLowerCase()}|${(marca || '').trim().toLowerCase()}`;
}

// Cria ou atualiza (upsert) o item correspondente na Despensa, por nome+marca.
// Se o item já estava "em uso", a quantidade da nova compra SOMA à que já tinha (reposição).
// Se já estava "acabou", reinicia do zero com a quantidade da nova compra e volta a "em uso".
async function upsertDespensaItem({ nome, marca, quantidade, unidade, dataCompra }) {
  const snap = await new Promise(res => { const u = onSnapshot(query(despensaCol), s => { res(s); u(); }); });
  const chave = chaveItem(nome, marca);
  const existente = snap.docs.find(d => chaveItem(d.data().nome, d.data().marca) === chave);

  if (existente) {
    const atual = existente.data();
    const aindaEmUso = atual.status !== 'acabou';
    const payload = {
      nome, marca: marca || null,
      unidade: unidade || atual.unidade || 'un',
      dataFim: null,
      status: 'em_uso'
    };
    if (aindaEmUso) {
      payload.quantidadeAtual = (atual.quantidadeAtual || 0) + quantidade;
    } else {
      payload.quantidadeAtual = quantidade;
      payload.dataInicio = dataCompra;
    }
    await updateDoc(doc(db, 'despensaItens', existente.id), payload);
  } else {
    await addDoc(despensaCol, {
      nome, marca: marca || null, quantidadeAtual: quantidade, unidade: unidade || 'un',
      dataInicio: dataCompra, dataFim: null, status: 'em_uso'
    });
  }
}

// Agrupa itens de uma compra por nome+marca, somando quantidades — evita que dois itens
// iguais na mesma compra sobrescrevam um ao outro na Despensa.
function agruparItensPorChave(itens) {
  const grupos = {};
  itens.forEach(item => {
    const chave = chaveItem(item.nome, item.marca);
    if (!grupos[chave]) grupos[chave] = { nome: item.nome, marca: item.marca, unidade: item.unidade, quantidade: 0 };
    grupos[chave].quantidade += (item.quantidade || 0);
  });
  return grupos;
}

// ==================== SUBMÓDULO: COMPRA ====================
export async function renderMercadoCompra(container) {
  const unsubs = [];
  const cartoes = await getCartoes();
  const contasDisponiveis = await getContas();
  let itensTemp = [{ id: uid() }];
  let pagamentosTemp = [{ id: uid(), formaPagamento: 'dinheiro' }];
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
          <div>
            <label>Desconto (cupom, etc.)</label><input type="number" step="0.01" id="m-desconto">
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

      <h3 style="margin-top:24px">Forma(s) de pagamento</h3>
      <p style="color:var(--text-dim); font-size:13px; margin-top:-8px">Pode dividir uma compra entre mais de uma forma de pagamento (ex: parte no cartão, parte no pix).</p>
      <div id="pagamentos-lista" style="margin-top:12px"></div>
      <button class="btn-ghost" id="btn-add-pagamento" style="margin-top:4px">+ Adicionar forma de pagamento</button>
      <div id="restante-pagamento" style="margin-top:10px; font-size:13px"></div>

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
    </div>

    <div id="mp-slot">${monthPickerHTML(mes)}</div>
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
  document.getElementById('m-taxa').addEventListener('input', atualizarTotal);
  document.getElementById('m-desconto').addEventListener('input', atualizarTotal);

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
        let corrigidos = 0;
        itensTemp = resultado.itens.map(item => {
          // A IA às vezes acerta o preço total do cupom mas erra a quantidade (ex: lê "1" quando eram 3 unidades).
          // Como ela também devolve precoTotal, usamos isso pra conferir e corrigir a quantidade quando bate a conta.
          let quantidade = item.quantidade ?? '';
          const precoUnitario = item.precoUnitario ?? '';
          const pu = parseFloat(precoUnitario);
          const pt = parseFloat(item.precoTotal);
          if (pu > 0 && !isNaN(pt)) {
            const qtdCalculada = Math.round((pt / pu) * 100) / 100;
            if (Math.abs(qtdCalculada - (parseFloat(quantidade) || 0)) > 0.05 && qtdCalculada > 0) {
              quantidade = qtdCalculada;
              corrigidos++;
            }
          }
          return {
            id: uid(), nome: item.nomeGenerico || item.nome || '', marca: item.marca || '',
            quantidade, precoUnitario, lidoPorIA: true
          };
        });
        renderItensLista();
        status.textContent = `${resultado.itens.length} item(ns) lido(s)${corrigidos ? ` (${corrigidos} quantidade(s) corrigida(s) com base no valor total)` : ''}. Revise as quantidades antes de salvar.`;
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
    sincronizarItensTemp();
    itensTemp.push({ id: uid() });
    renderItensLista();
  });
  renderPagamentosLista();
  document.getElementById('btn-add-pagamento').addEventListener('click', () => {
    sincronizarPagamentosTemp();
    const total = calcularValorTotalCompra();
    const somaAtual = pagamentosTemp.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0);
    const restante = Math.max(0, total - somaAtual);
    pagamentosTemp.push({ id: uid(), formaPagamento: 'dinheiro', valor: restante || '' });
    renderPagamentosLista();
  });
  document.getElementById('btn-salvar-compra').addEventListener('click', salvarCompra);
  document.getElementById('btn-cancelar-edicao').addEventListener('click', () => resetForm());

  // Lê o que está preenchido em cada linha na tela e atualiza itensTemp,
  // pra nada se perder antes de adicionar/remover uma linha ou salvar.
  function sincronizarItensTemp() {
    document.querySelectorAll('[data-item-id]').forEach(row => {
      const item = itensTemp.find(i => i.id === row.dataset.itemId);
      if (!item) return;
      item.nome = row.querySelector('.i-nome').value;
      item.marca = row.querySelector('.i-marca').value;
      item.quantidade = row.querySelector('.i-qtd').value;
      item.unidade = row.querySelector('.i-unidade').value;
      item.precoUnitario = row.querySelector('.i-preco').value;
    });
  }

  function renderItensLista() {
    const el = document.getElementById('itens-lista');
    el.innerHTML = `
      <div class="item-row item-row-header">
        <span>Item (nome genérico)</span><span>Marca (opcional)</span><span>Qtd / Un.</span><span>Preço unit.</span><span></span>
      </div>
      ${itensTemp.map(item => `
      <div class="item-row" data-item-id="${item.id}">
        <div style="display:flex; align-items:center; gap:6px">
          <input type="text" class="i-nome" placeholder="Ex: Detergente" value="${item.nome || ''}">
          ${item.lidoPorIA ? '<span class="tag" title="Preenchido pela IA, revise">IA</span>' : ''}
        </div>
        <input type="text" class="i-marca" placeholder="Ex: Ypê" value="${item.marca || ''}">
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
        sincronizarItensTemp();
        itensTemp = itensTemp.filter(i => i.id !== btn.dataset.removeItem);
        renderItensLista();
      });
    });
    el.querySelectorAll('.i-qtd, .i-preco').forEach(inp => inp.addEventListener('input', atualizarTotal));
    atualizarTotal();
  }

  function calcularValorTotalCompra() {
    let total = 0;
    document.querySelectorAll('[data-item-id]').forEach(row => {
      const qtd = parseFloat(row.querySelector('.i-qtd').value) || 0;
      const preco = parseFloat(row.querySelector('.i-preco').value) || 0;
      total += qtd * preco;
    });
    const taxa = parseFloat(document.getElementById('m-taxa')?.value) || 0;
    const desconto = parseFloat(document.getElementById('m-desconto')?.value) || 0;
    return Math.max(0, total + taxa - desconto);
  }

  function atualizarTotal() {
    const total = calcularValorTotalCompra();
    document.getElementById('m-total-display').textContent = formatBRL(total);
    atualizarRestante();
  }

  // ===== Pagamentos (split) =====
  // Lê o que está preenchido em cada linha de pagamento na tela e atualiza pagamentosTemp,
  // do mesmo jeito que sincronizarItensTemp faz para os itens.
  function sincronizarPagamentosTemp() {
    document.querySelectorAll('[data-pagamento-id]').forEach(row => {
      const p = pagamentosTemp.find(x => x.id === row.dataset.pagamentoId);
      if (!p) return;
      p.formaPagamento = row.querySelector('.p-forma').value;
      const valorInput = row.querySelector('.p-valor');
      if (valorInput) p.valor = valorInput.value;
      const cartaoSel = row.querySelector('.p-cartao');
      if (cartaoSel) p.cartaoId = cartaoSel.value;
      const parceladoSel = row.querySelector('.p-parcelado');
      if (parceladoSel) p.parcelado = parceladoSel.value;
      const parcelasInp = row.querySelector('.p-parcelas');
      if (parcelasInp) p.numParcelas = parcelasInp.value;
      const valeTitularSel = row.querySelector('.p-vale-titular');
      if (valeTitularSel) p.valeTitular = valeTitularSel.value;
      const valeTipoSel = row.querySelector('.p-vale-tipo');
      if (valeTipoSel) p.valeTipo = valeTipoSel.value;
      const contaSel = row.querySelector('.p-conta');
      if (contaSel) p.contaSaidaId = contaSel.value;
    });
  }

  function pagamentoRowHTML(p, multiplo) {
    const forma = p.formaPagamento || 'dinheiro';
    const isCredito = forma === 'credito';
    const isVale = forma === 'vale';
    const isAVista = ['dinheiro', 'debito', 'pix'].includes(forma);
    return `
      <div class="pagamento-row" data-pagamento-id="${p.id}" style="border:1px solid var(--border); border-radius:8px; padding:14px; margin-bottom:12px">
        <div class="grid grid-4">
          <div><label>Forma de pagamento</label>
            <select class="p-forma">
              <option value="dinheiro" ${forma === 'dinheiro' ? 'selected' : ''}>Dinheiro</option>
              <option value="debito" ${forma === 'debito' ? 'selected' : ''}>Débito</option>
              <option value="credito" ${forma === 'credito' ? 'selected' : ''}>Crédito</option>
              <option value="pix" ${forma === 'pix' ? 'selected' : ''}>Pix</option>
              <option value="vale" ${forma === 'vale' ? 'selected' : ''}>Vale Alimentação</option>
            </select>
          </div>
          ${multiplo ? `<div><label>Valor desta parte</label><input type="number" step="0.01" class="p-valor" value="${p.valor ?? ''}"></div>` : ''}
          <div class="p-cartao-wrap conditional ${isCredito ? 'show' : ''}">
            <label>Qual cartão</label>
            <select class="p-cartao">${cartoes.map(c => `<option value="${c.id}" ${p.cartaoId === c.id ? 'selected' : ''}>${formatCartao(c)}</option>`).join('')}</select>
          </div>
          <div class="p-parcelado-wrap conditional ${isCredito ? 'show' : ''}">
            <label>Parcelado?</label>
            <select class="p-parcelado"><option value="nao" ${p.parcelado !== 'sim' ? 'selected' : ''}>Não</option><option value="sim" ${p.parcelado === 'sim' ? 'selected' : ''}>Sim</option></select>
          </div>
          <div class="p-parcelas-wrap conditional ${isCredito && p.parcelado === 'sim' ? 'show' : ''}">
            <label>Número de parcelas</label><input type="number" class="p-parcelas" min="2" value="${p.numParcelas || ''}">
          </div>
          <div class="p-vale-titular-wrap conditional ${isVale ? 'show' : ''}">
            <label>De quem é o vale</label>
            <select class="p-vale-titular"><option ${(!p.valeTitular || p.valeTitular === 'Natasha') ? 'selected' : ''}>Natasha</option><option ${p.valeTitular === 'Daniel' ? 'selected' : ''}>Daniel</option></select>
          </div>
          <div class="p-vale-tipo-wrap conditional ${isVale ? 'show' : ''}">
            <label>Tipo de saldo</label>
            <select class="p-vale-tipo"><option value="livre" ${(p.valeTipo || 'livre') === 'livre' ? 'selected' : ''}>Livre</option><option value="voucher" ${p.valeTipo === 'voucher' ? 'selected' : ''}>Voucher</option></select>
          </div>
          <div class="p-conta-wrap conditional ${isAVista ? 'show' : ''}">
            <label>Conta de saída</label>
            <select class="p-conta">
              <option value="">Selecione a conta</option>
              ${contasDisponiveis.map(c => `<option value="${c.id}" ${p.contaSaidaId === c.id ? 'selected' : ''}>${formatConta(c)}</option>`).join('')}
            </select>
          </div>
        </div>
        ${multiplo ? `<button class="btn-danger" data-remove-pagamento="${p.id}" style="margin-top:8px">Remover esta forma</button>` : ''}
      </div>
    `;
  }

  function renderPagamentosLista() {
    const el = document.getElementById('pagamentos-lista');
    const multiplo = pagamentosTemp.length > 1;
    el.innerHTML = pagamentosTemp.map(p => pagamentoRowHTML(p, multiplo)).join('');

    el.querySelectorAll('.p-forma, .p-parcelado').forEach(sel => {
      sel.addEventListener('change', () => { sincronizarPagamentosTemp(); renderPagamentosLista(); });
    });
    el.querySelectorAll('.p-valor').forEach(inp => {
      inp.addEventListener('input', () => { sincronizarPagamentosTemp(); atualizarRestante(); });
    });
    el.querySelectorAll('[data-remove-pagamento]').forEach(btn => {
      btn.addEventListener('click', () => {
        sincronizarPagamentosTemp();
        if (pagamentosTemp.length <= 1) return;
        pagamentosTemp = pagamentosTemp.filter(p => p.id !== btn.dataset.removePagamento);
        renderPagamentosLista();
      });
    });
    atualizarRestante();
  }

  function atualizarRestante() {
    const restanteEl = document.getElementById('restante-pagamento');
    if (!restanteEl) return;
    if (pagamentosTemp.length <= 1) { restanteEl.innerHTML = ''; return; }
    const total = calcularValorTotalCompra();
    const soma = Array.from(document.querySelectorAll('.p-valor')).reduce((s, inp) => s + (parseFloat(inp.value) || 0), 0);
    const restante = total - soma;
    if (Math.abs(restante) < 0.01) {
      restanteEl.innerHTML = `<span style="color:var(--olive)">✓ As partes somam o valor total (${formatBRL(total)}).</span>`;
    } else if (restante > 0) {
      restanteEl.innerHTML = `<span style="color:var(--terracota)">Faltam alocar ${formatBRL(restante)} para bater com o total (${formatBRL(total)}).</span>`;
    } else {
      restanteEl.innerHTML = `<span style="color:var(--terracota)">As partes somam ${formatBRL(Math.abs(restante))} a mais que o total (${formatBRL(total)}).</span>`;
    }
  }

  function resetForm() {
    editandoId = null;
    edicaoOriginal = null;
    itensTemp = [{ id: uid() }];
    pagamentosTemp = [{ id: uid(), formaPagamento: 'dinheiro' }];
    document.getElementById('editando-aviso').style.display = 'none';
    document.getElementById('btn-cancelar-edicao').style.display = 'none';
    document.getElementById('btn-salvar-compra').textContent = 'Salvar compra';
    document.getElementById('m-data').value = todayISO();
    document.getElementById('m-mercado').value = '';
    document.getElementById('m-desconto').value = '';
    renderItensLista();
    renderPagamentosLista();
  }

  async function carregarParaEdicao(compra) {
    editandoId = compra.id;
    // Guarda o estado original de pagamentos pra poder reverter saldo/espelhos ao salvar a edição.
    const pagamentosOriginais = Array.isArray(compra.pagamentos)
      ? compra.pagamentos
      : [{ id: uid(), formaPagamento: compra.formaPagamento, valor: compra.valorTotal, cartaoId: compra.cartaoId || null,
           parcelado: compra.parcelado ? 'sim' : 'nao', numParcelas: compra.numParcelas || null,
           valeTitular: compra.valeTitular || null, valeTipo: compra.valeTipo || null, contaSaidaId: compra.contaSaidaId || null }];
    edicaoOriginal = { valorTotal: compra.valorTotal || 0, itens: compra.itens || [], pagamentos: pagamentosOriginais };

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
    document.getElementById('m-desconto').value = compra.desconto || '';

    itensTemp = (compra.itens || []).map(i => ({ id: uid(), ...i }));
    renderItensLista();

    pagamentosTemp = pagamentosOriginais.map(p => ({
      id: uid(), formaPagamento: p.formaPagamento, valor: p.valor,
      cartaoId: p.cartaoId || null, parcelado: p.parcelado === true ? 'sim' : (p.parcelado || 'nao'),
      numParcelas: p.numParcelas || null, valeTitular: p.valeTitular || null, valeTipo: p.valeTipo || null,
      contaSaidaId: p.contaSaidaId || null
    }));
    renderPagamentosLista();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function salvarCompra() {
    const data = document.getElementById('m-data').value;
    const mercado = document.getElementById('m-mercado').value || 'Não informado';
    const modalidade = document.getElementById('m-modalidade').value;
    const taxaEntrega = modalidade === 'online' ? (parseFloat(document.getElementById('m-taxa').value) || 0) : 0;
    const desconto = parseFloat(document.getElementById('m-desconto').value) || 0;

    const itens = [];
    document.querySelectorAll('[data-item-id]').forEach(row => {
      const nome = row.querySelector('.i-nome').value;
      if (!nome) return;
      const qtd = parseFloat(row.querySelector('.i-qtd').value) || 0;
      const preco = parseFloat(row.querySelector('.i-preco').value) || 0;
      itens.push({
        nome, marca: row.querySelector('.i-marca').value || null,
        quantidade: qtd, unidade: row.querySelector('.i-unidade').value,
        precoUnitario: preco, precoTotal: qtd * preco
      });
    });
    if (!itens.length) { alert('Adicione pelo menos um item.'); return; }
    const valorTotal = Math.max(0, itens.reduce((s, i) => s + i.precoTotal, 0) + taxaEntrega - desconto);

    // Monta e valida as partes de pagamento
    sincronizarPagamentosTemp();
    const multiplo = pagamentosTemp.length > 1;
    const pagamentos = [];
    for (const p of pagamentosTemp) {
      const formaPagamento = p.formaPagamento || 'dinheiro';
      const valor = multiplo ? (parseFloat(p.valor) || 0) : valorTotal;
      if (multiplo && valor <= 0) { alert('Preencha o valor de cada forma de pagamento.'); return; }
      const isCredito = formaPagamento === 'credito';
      const isVale = formaPagamento === 'vale';
      const isAVista = ['dinheiro', 'debito', 'pix'].includes(formaPagamento);
      if (isCredito && !p.cartaoId) { alert('Selecione o cartão em cada forma de pagamento no crédito.'); return; }
      if (isAVista && !p.contaSaidaId) { alert('Selecione de qual conta saiu cada forma de pagamento à vista.'); return; }
      pagamentos.push({
        id: p.id || uid(),
        formaPagamento, valor,
        cartaoId: isCredito ? p.cartaoId : null,
        parcelado: isCredito && p.parcelado === 'sim',
        numParcelas: (isCredito && p.parcelado === 'sim') ? (parseInt(p.numParcelas) || 1) : 1,
        valeTitular: isVale ? (p.valeTitular || 'Natasha') : null,
        valeTipo: isVale ? (p.valeTipo || 'livre') : null,
        contaSaidaId: isAVista ? p.contaSaidaId : null
      });
    }
    if (multiplo) {
      const soma = pagamentos.reduce((s, p) => s + p.valor, 0);
      if (Math.abs(soma - valorTotal) >= 0.01) {
        alert(`A soma das formas de pagamento (${formatBRL(soma)}) não bate com o valor total da compra (${formatBRL(valorTotal)}).`);
        return;
      }
    }

    const payload = { data, mercado, modalidade, taxaEntrega, desconto, pagamentos, valorTotal, itens };

    let compraId;
    if (editandoId) {
      compraId = editandoId;
      await updateDoc(doc(db, 'mercadoCompras', compraId), payload);

      // Reverte o saldo das contas usadas nas partes à vista antigas
      for (const p of (edicaoOriginal?.pagamentos || [])) {
        const isAVistaAntiga = ['dinheiro', 'debito', 'pix'].includes(p.formaPagamento);
        if (isAVistaAntiga && p.contaSaidaId) {
          await ajustarSaldoConta(p.contaSaidaId, p.valor);
        }
      }
      // Ajusta a Despensa pela diferença entre os itens antigos e os novos.
      // Cada item é isolado num try/catch: se um falhar, os outros continuam normalmente
      // e juntamos os erros pra avisar você no final, em vez de travar tudo em silêncio.
      const gruposAntigos = agruparItensPorChave(edicaoOriginal?.itens || []);
      const gruposNovos = agruparItensPorChave(itens);
      const chaves = new Set([...Object.keys(gruposAntigos), ...Object.keys(gruposNovos)]);
      const snapDespensa = await new Promise(res => { const u = onSnapshot(query(despensaCol), s => { res(s); u(); }); });
      const falhasDespensa = [];
      for (const chave of chaves) {
        try {
          const qtdAntiga = gruposAntigos[chave]?.quantidade || 0;
          const qtdNova = gruposNovos[chave]?.quantidade || 0;
          const delta = qtdNova - qtdAntiga;
          if (!delta) continue;
          const info = gruposNovos[chave] || gruposAntigos[chave];
          const existente = snapDespensa.docs.find(d => chaveItem(d.data().nome, d.data().marca) === chave);
          if (existente) {
            const atual = existente.data();
            await updateDoc(doc(db, 'despensaItens', existente.id), { quantidadeAtual: Math.max(0, (atual.quantidadeAtual || 0) + delta) });
          } else if (qtdNova > 0) {
            await addDoc(despensaCol, { nome: info.nome, marca: info.marca || null, quantidadeAtual: qtdNova, unidade: info.unidade || 'un', dataInicio: data, dataFim: null, status: 'em_uso' });
          }
        } catch (err) {
          console.error('Falha ao atualizar despensa para item:', chave, err);
          falhasDespensa.push(`${(gruposNovos[chave] || gruposAntigos[chave])?.nome || chave}: ${err.message || err}`);
        }
      }
      if (falhasDespensa.length) {
        alert(`Compra atualizada, mas ${falhasDespensa.length} item(ns) NÃO entraram na despensa:\n\n${falhasDespensa.join('\n')}\n\nAvise pra eu corrigir.`);
      }
    } else {
      const ref = await addDoc(comprasCol, payload);
      compraId = ref.id;
      // Todo item comprado vai automaticamente para a Despensa (agrupado por nome+marca, corrige duplicatas na mesma compra).
      // Cada grupo é isolado num try/catch: se um falhar, os outros continuam normalmente
      // e juntamos os erros pra avisar você no final, em vez de travar tudo em silêncio.
      const grupos = agruparItensPorChave(itens);
      const falhasDespensa = [];
      for (const grupo of Object.values(grupos)) {
        try {
          await upsertDespensaItem({ nome: grupo.nome, marca: grupo.marca, quantidade: grupo.quantidade, unidade: grupo.unidade, dataCompra: data });
        } catch (err) {
          console.error('Falha ao registrar na despensa o item:', grupo.nome, err);
          falhasDespensa.push(`${grupo.nome}${grupo.marca ? ' (' + grupo.marca + ')' : ''}: ${err.message || err}`);
        }
      }
      if (falhasDespensa.length) {
        alert(`Compra salva, mas ${falhasDespensa.length} item(ns) NÃO entraram na despensa:\n\n${falhasDespensa.join('\n')}\n\nAvise pra eu corrigir.`);
      }
    }

    // Recria do zero os lançamentos-espelho no Cartão (um por parte no crédito)
    await removerLancamentosEspelhoMercado(compraId);
    for (const p of pagamentos) {
      if (p.formaPagamento !== 'credito') continue;
      await upsertLancamentoEspelho({
        origem: 'mercado', origemId: `${compraId}::${p.id}`, cartaoId: p.cartaoId, valorTotal: p.valor,
        parcelado: p.parcelado, numParcelas: p.numParcelas, data,
        descricao: multiplo ? `Compra de mercado (${mercado}) - parte` : `Compra de mercado (${mercado})`,
        categoria: 'Mercado'
      });
    }

    // Aplica o saldo das contas usadas nas partes à vista novas
    let algumSaldoNegativo = false;
    for (const p of pagamentos) {
      const isAVista = ['dinheiro', 'debito', 'pix'].includes(p.formaPagamento);
      if (isAVista && p.contaSaidaId) {
        const novoSaldo = await ajustarSaldoConta(p.contaSaidaId, -p.valor);
        if (novoSaldo !== null && novoSaldo < 0) algumSaldoNegativo = true;
      }
    }
    if (algumSaldoNegativo) {
      alert('Compra registrada. Atenção: o saldo de alguma conta usada ficou negativo.');
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
                <td>${formatFormasPagamento(c)}</td>
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
          const partesAVista = Array.isArray(compra?.pagamentos)
            ? compra.pagamentos.filter(p => ['dinheiro', 'debito', 'pix'].includes(p.formaPagamento) && p.contaSaidaId)
            : (compra?.contaSaidaId ? [{ contaSaidaId: compra.contaSaidaId, valor: compra.valorTotal }] : []);
          for (const p of partesAVista) {
            await ajustarSaldoConta(p.contaSaidaId, p.valor);
          }
          await deleteDoc(doc(db, 'mercadoCompras', btn.dataset.del));
          await removerLancamentosEspelhoMercado(btn.dataset.del);
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
  let editandoId = null;

  container.innerHTML = `
    <h2 class="module-title">Mercado · Despensa</h2>
    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-despensa-body', 'Adicionar item')}
      <div id="form-despensa-body" class="collapsible-body collapsed">
        <div id="despensa-editando-aviso" style="display:none; color:var(--gold); font-size:13px; margin-bottom:10px"></div>
        <div class="grid grid-4" style="margin-top:12px">
          <div><label>Nome</label><input type="text" id="d-nome" placeholder="Ex: Detergente"></div>
          <div><label>Marca (opcional)</label><input type="text" id="d-marca" placeholder="Ex: Ypê"></div>
          <div><label>Quantidade</label>
            <div style="display:flex; gap:4px">
              <input type="number" id="d-quantidade" style="width:70px">
              <select id="d-unidade">${UNIDADES.map(u => `<option>${u}</option>`).join('')}</select>
            </div>
          </div>
          <div><label>Início (em uso desde)</label><input type="date" id="d-data-inicio" value="${todayISO()}"></div>
        </div>
        <div style="display:flex; gap:8px">
          <button class="btn-ghost" id="btn-cancelar-despensa" style="display:none">Cancelar edição</button>
          <button class="btn" id="btn-add-despensa">Adicionar à despensa</button>
        </div>
      </div>
    </div>
    <div id="lista-despensa"></div>
  `;
  wireCollapsible(container);

  function resetFormDespensa() {
    editandoId = null;
    document.getElementById('despensa-editando-aviso').style.display = 'none';
    document.getElementById('btn-cancelar-despensa').style.display = 'none';
    document.getElementById('btn-add-despensa').textContent = 'Adicionar à despensa';
    document.getElementById('d-nome').value = '';
    document.getElementById('d-marca').value = '';
    document.getElementById('d-quantidade').value = '';
    document.getElementById('d-data-inicio').value = todayISO();
  }
  document.getElementById('btn-cancelar-despensa').addEventListener('click', resetFormDespensa);

  document.getElementById('btn-add-despensa').addEventListener('click', async () => {
    const nome = document.getElementById('d-nome').value;
    if (!nome) { alert('Informe o nome do item.'); return; }
    const payload = {
      nome, marca: document.getElementById('d-marca').value || null,
      quantidadeAtual: parseFloat(document.getElementById('d-quantidade').value) || 0,
      unidade: document.getElementById('d-unidade').value,
      dataInicio: document.getElementById('d-data-inicio').value || todayISO()
    };
    if (editandoId) {
      await updateDoc(doc(db, 'despensaItens', editandoId), payload);
    } else {
      await addDoc(despensaCol, { ...payload, dataFim: null, status: 'em_uso' });
    }
    resetFormDespensa();
  });

  const mesAtual = currentMonthRef();
  let comprasDoMes = [];

  const unsubCompras = onSnapshot(query(comprasCol), (snap) => {
    comprasDoMes = snap.docs.map(d => d.data()).filter(c => monthRefFromDate(c.data) === mesAtual);
  });
  unsubs.push(unsubCompras);

  const unsub = onSnapshot(query(despensaCol), (snap) => {
    const itens = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.dataInicio || '').localeCompare(a.dataInicio || ''));
    const el = document.getElementById('lista-despensa');
    if (!itens.length) {
      el.innerHTML = '<div class="empty-state">Nenhum item na despensa ainda.</div>';
      return;
    }

    el.innerHTML = `
      <table>
        <thead><tr><th>Item</th><th>Quantidade</th><th>Início</th><th>Fim</th><th>Duração</th><th>Frequência de compra (mês)</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          ${itens.map(i => {
            const frequencia = comprasDoMes.filter(c => (c.itens || []).some(it => chaveItem(it.nome, it.marca) === chaveItem(i.nome, i.marca))).length;
            const fimEfetivo = i.dataFim || todayISO();
            const dias = i.dataInicio ? daysBetween(i.dataInicio, fimEfetivo) : null;
            const duracaoTexto = dias === null ? '-' : `${dias} dia(s)${!i.dataFim ? ' (em andamento)' : ''}`;
            return `
            <tr>
              <td>${i.nome}${i.marca ? ' - ' + i.marca : ''}</td>
              <td>${i.quantidadeAtual ?? '-'} ${i.unidade || ''}</td>
              <td><input type="date" class="input-data-inicio" data-id="${i.id}" value="${i.dataInicio || ''}" style="margin-bottom:0; width:150px"></td>
              <td><input type="date" class="input-data-fim" data-id="${i.id}" value="${i.dataFim || ''}" style="margin-bottom:0; width:150px"></td>
              <td>${duracaoTexto}</td>
              <td>${frequencia}x</td>
              <td>
                <select class="input-status" data-id="${i.id}" style="margin-bottom:0">
                  <option value="em_uso" ${i.status !== 'acabou' ? 'selected' : ''}>Em uso</option>
                  <option value="acabou" ${i.status === 'acabou' ? 'selected' : ''}>Acabou</option>
                </select>
              </td>
              <td>
                <button class="btn-ghost" data-editar="${i.id}">Editar</button>
                <button class="btn-danger" data-del="${i.id}">Excluir</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;

    el.querySelectorAll('.input-data-inicio').forEach(inp => {
      inp.addEventListener('change', async () => {
        await updateDoc(doc(db, 'despensaItens', inp.dataset.id), { dataInicio: inp.value || null });
      });
    });
    el.querySelectorAll('.input-data-fim').forEach(inp => {
      inp.addEventListener('change', async () => {
        const dataFim = inp.value || null;
        await updateDoc(doc(db, 'despensaItens', inp.dataset.id), {
          dataFim,
          status: dataFim ? 'acabou' : 'em_uso'
        });
      });
    });
    el.querySelectorAll('.input-status').forEach(sel => {
      sel.addEventListener('change', async () => {
        const item = itens.find(i => i.id === sel.dataset.id);
        const patch = { status: sel.value };
        if (sel.value === 'acabou' && !item.dataFim) patch.dataFim = todayISO();
        if (sel.value === 'em_uso') patch.dataFim = null;
        await updateDoc(doc(db, 'despensaItens', sel.dataset.id), patch);
      });
    });
    el.querySelectorAll('[data-editar]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = itens.find(x => x.id === btn.dataset.editar);
        editandoId = i.id;
        document.getElementById('form-despensa-body').classList.remove('collapsed');
        document.getElementById('despensa-editando-aviso').style.display = 'block';
        document.getElementById('despensa-editando-aviso').textContent = `Editando: ${i.nome}`;
        document.getElementById('btn-cancelar-despensa').style.display = 'inline-block';
        document.getElementById('btn-add-despensa').textContent = 'Atualizar item';
        document.getElementById('d-nome').value = i.nome;
        document.getElementById('d-marca').value = i.marca || '';
        document.getElementById('d-quantidade').value = i.quantidadeAtual ?? '';
        document.getElementById('d-unidade').value = i.unidade || 'un';
        document.getElementById('d-data-inicio').value = i.dataInicio || todayISO();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    el.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Excluir este item da despensa?')) await deleteDoc(doc(db, 'despensaItens', btn.dataset.del));
      });
    });
  });
  unsubs.push(unsub);
  return unsubs;
}

// ==================== SUBMÓDULO: LISTA DE COMPRAS (autônoma) ====================
const ICON_PENCIL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
const ICON_TRASH = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

export function renderMercadoLista(container) {
  const unsubs = [];
  let editandoId = null;

  container.innerHTML = `
    <h2 class="module-title">Mercado · Lista de compras</h2>
    <p style="color:var(--text-dim); font-size:13px; margin-top:-14px">Lista independente — não puxa nada automaticamente da Despensa ou do Financeiro.</p>
    <div class="card" style="margin-bottom:24px">
      <h3>Adicionar item</h3>
      <div id="lc-editando-aviso" style="display:none; color:var(--gold); font-size:13px; margin-top:8px"></div>
      <div style="display:flex; gap:8px; margin-top:12px; align-items:flex-end">
        <div style="flex:1"><label>Item</label><input type="text" id="lc-nome" placeholder="Nome do item" style="margin-bottom:0"></div>
        <div style="width:100px"><label>Quantidade</label><input type="number" id="lc-quantidade" style="margin-bottom:0"></div>
        <button class="btn-ghost" id="btn-cancelar-lc" style="display:none">Cancelar</button>
        <button class="btn btn-blue" id="btn-add-lc">Adicionar</button>
      </div>
    </div>
    <div class="card">
      <div id="lista-compras-itens"></div>
    </div>
    <div style="margin-top:16px; display:flex; justify-content:space-between; align-items:center">
      <span id="lc-contador" style="color:var(--text-dim); font-size:13px"></span>
      <button class="btn-ghost" id="btn-limpar-lista">Limpar itens comprados</button>
    </div>
  `;

  function resetForm() {
    editandoId = null;
    document.getElementById('lc-editando-aviso').style.display = 'none';
    document.getElementById('btn-cancelar-lc').style.display = 'none';
    document.getElementById('btn-add-lc').textContent = 'Adicionar';
    document.getElementById('lc-nome').value = '';
    document.getElementById('lc-quantidade').value = '';
  }
  document.getElementById('btn-cancelar-lc').addEventListener('click', resetForm);

  document.getElementById('btn-add-lc').addEventListener('click', async () => {
    const nome = document.getElementById('lc-nome').value;
    if (!nome) return;
    const quantidade = parseFloat(document.getElementById('lc-quantidade').value) || null;
    if (editandoId) {
      await updateDoc(doc(db, 'listaCompras', editandoId), { nome, quantidade });
    } else {
      await addDoc(listaComprasCol, { nome, quantidade, comprado: false, criadoEm: todayISO() });
    }
    resetForm();
  });

  const unsub = onSnapshot(query(listaComprasCol), (snap) => {
    const itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const el = document.getElementById('lista-compras-itens');
    const compradosCount = itens.filter(i => i.comprado).length;
    document.getElementById('lc-contador').textContent = `${compradosCount} de ${itens.length} comprado(s)`;

    if (!itens.length) {
      el.innerHTML = '<div class="empty-state">Nenhum item na lista.</div>';
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th></th><th>Item</th><th>Quantidade</th><th>Comprado?</th><th>Ações</th></tr></thead>
        <tbody>
          ${itens.map(i => `
            <tr class="${i.comprado ? 'riscado' : ''}">
              <td><input type="checkbox" data-toggle="${i.id}" ${i.comprado ? 'checked' : ''}></td>
              <td>${i.nome}</td>
              <td>${i.quantidade ?? '-'}</td>
              <td>${i.comprado ? 'Sim' : 'Não'}</td>
              <td>
                <button class="icon-btn icon-edit" data-editar-lc="${i.id}" title="Editar">${ICON_PENCIL}</button>
                <button class="icon-btn icon-delete" data-del-lc="${i.id}" title="Excluir">${ICON_TRASH}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    el.querySelectorAll('[data-toggle]').forEach(chk => {
      chk.addEventListener('change', async () => {
        await updateDoc(doc(db, 'listaCompras', chk.dataset.toggle), { comprado: chk.checked });
      });
    });
    el.querySelectorAll('[data-editar-lc]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = itens.find(x => x.id === btn.dataset.editarLc);
        editandoId = i.id;
        document.getElementById('lc-editando-aviso').style.display = 'block';
        document.getElementById('lc-editando-aviso').textContent = `Editando: ${i.nome}`;
        document.getElementById('btn-cancelar-lc').style.display = 'inline-block';
        document.getElementById('btn-add-lc').textContent = 'Atualizar';
        document.getElementById('lc-nome').value = i.nome;
        document.getElementById('lc-quantidade').value = i.quantidade ?? '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    el.querySelectorAll('[data-del-lc]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await deleteDoc(doc(db, 'listaCompras', btn.dataset.delLc));
      });
    });
  });
  unsubs.push(unsub);

  document.getElementById('btn-limpar-lista').addEventListener('click', async () => {
    const snap = await new Promise(res => { const u = onSnapshot(query(listaComprasCol), s => { res(s); u(); }); });
    const comprados = snap.docs.filter(d => d.data().comprado);
    for (const d of comprados) await deleteDoc(doc(db, 'listaCompras', d.id));
  });

  return unsubs;
}
