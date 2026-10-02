import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, formatDate, todayISO, daysBetween, uid, currentMonthRef,
  monthRefFromDate, monthPickerHTML, wireMonthPicker, formatCartao, formatConta,
  collapsibleHeaderHTML, wireCollapsible, FORMAS_A_VISTA, ROTULO_FORMA, MAX_PAGAMENTOS,
  getPagamentos, resumoPagamentos, semPagamentoReconhecido
} from '../helpers.js';
import { getCartoes, upsertLancamentoEspelho, removerLancamentosEspelhoDaOrigem } from './cartao.js';
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
  let pagamentosTemp = [novoPagamento()];
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
        <h3>Ler cupom ou print de app (IA)</h3>
        <p style="color:var(--text-dim); font-size:13px; margin-top:0">Tire uma foto do cupom, anexe uma imagem da galeria ou envie prints de pedidos do iFood, 99 etc. (pode escolher várias imagens do mesmo pedido). A IA preenche os campos abaixo. Revise sempre antes de salvar.</p>
        <input type="file" id="input-foto-camera" accept="image/*" capture="environment" style="display:none">
        <input type="file" id="input-foto-arquivo" accept="image/*" multiple style="display:none">
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
          <button class="btn-ghost" id="btn-scan-camera">📷 Tirar foto</button>
          <button class="btn-ghost" id="btn-scan-arquivo">🖼️ Anexar imagem / print</button>
          <span id="scan-status" style="color:var(--text-dim); font-size:13px"></span>
        </div>
      </div>

      <h3>Itens</h3>
      <div id="itens-lista" style="margin-top:16px"></div>
      <button class="btn-ghost" id="btn-add-item" style="margin-top:8px">+ Adicionar item</button>

      <h3 style="margin-top:24px">Pagamento</h3>
      <p style="color:var(--text-dim); font-size:13px; margin-top:0">Com uma forma só, ela paga o total. Para dividir (ex: parte no cartão, parte no vale), adicione outra forma e informe o valor de cada uma.</p>
      <div id="pagamentos-lista"></div>
      <div style="display:flex; align-items:center; gap:12px; margin-top:8px">
        <button class="btn-ghost" id="btn-add-pagamento">+ Adicionar forma de pagamento</button>
        <span id="pag-status" style="font-size:13px"></span>
      </div>

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
  document.getElementById('btn-scan-camera').addEventListener('click', () => document.getElementById('input-foto-camera').click());
  document.getElementById('btn-scan-arquivo').addEventListener('click', () => document.getElementById('input-foto-arquivo').click());
  ['input-foto-camera', 'input-foto-arquivo'].forEach(id => {
    document.getElementById(id).addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []).slice(0, 4);
      if (files.length) await lerComprovante(files);
      e.target.value = '';
    });
  });

  async function lerComprovante(files) {
    const status = document.getElementById('scan-status');
    status.style.color = 'var(--text-dim)';
    status.textContent = files.length > 1 ? `Lendo ${files.length} imagens, aguarde...` : 'Lendo imagem, aguarde...';
    try {
      const images = [];
      for (const f of files) images.push(await comprimirImagem(f));
      const resp = await fetch('/api/scan-cupom', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images })
      });
      const texto = await resp.text();
      let resultado = null;
      try { resultado = JSON.parse(texto); } catch (_) { /* resposta não-JSON (ex: página de erro do Vercel) */ }
      if (!resp.ok || !resultado) {
        console.error('scan-cupom', resp.status, texto);
        const motivo = resultado?.error
          || (resp.status === 404 ? 'a função /api/scan-cupom não foi encontrada (só funciona publicada no Vercel, não abrindo o arquivo local)'
          : resp.status === 413 ? 'a imagem ficou grande demais para enviar'
          : `o servidor respondeu HTTP ${resp.status}`);
        status.style.color = 'var(--terracota)';
        status.textContent = `Não consegui ler: ${motivo}${resultado?.details ? ' — ' + String(resultado.details).slice(0, 160) : ''}`;
        return;
      }
      preencherComResultado(resultado);
    } catch (err) {
      console.error('scan-cupom', err);
      status.style.color = 'var(--terracota)';
      status.textContent = `Erro ao processar a imagem: ${err.message || err}`;
    }
  }

  function preencherComResultado(r) {
    const status = document.getElementById('scan-status');
    const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
    if (r.mercado && !document.getElementById('m-mercado').value) document.getElementById('m-mercado').value = r.mercado;
    if (r.dataCompra && /^\d{4}-\d{2}-\d{2}$/.test(r.dataCompra)) document.getElementById('m-data').value = r.dataCompra;

    const ehApp = r.tipoDocumento === 'app_delivery';
    const taxa = num(r.taxaEntrega);
    if (ehApp || (taxa && taxa > 0)) {
      document.getElementById('m-modalidade').value = 'online';
      document.getElementById('m-taxa-wrap').classList.add('show');
      if (taxa !== null) document.getElementById('m-taxa').value = taxa;
    }
    if (num(r.desconto) > 0) document.getElementById('m-desconto').value = r.desconto;

    if (!Array.isArray(r.itens) || !r.itens.length) {
      status.style.color = 'var(--terracota)';
      status.textContent = 'A IA não encontrou itens legíveis nessa imagem.';
      atualizarTotal();
      return;
    }
    itensTemp = r.itens.map(item => {
      const qtd = num(item.quantidade) || 1;
      const unit = num(item.precoUnitario) ?? (num(item.precoTotal) !== null ? Math.round((item.precoTotal / qtd) * 100) / 100 : '');
      return { id: uid(), nome: item.nomeGenerico || item.nome || '', marca: item.marca || '', quantidade: qtd, precoUnitario: unit, lidoPorIA: true };
    });
    renderItensLista();

    // Confere o total lido com o total calculado, para pegar item perdido ou preço errado
    let msg = `${r.itens.length} item(ns) lido(s)${ehApp ? ' do app' : ''}. Revise antes de salvar.`;
    const totalCalc = parseFloat(document.getElementById('m-total-display').dataset.valor || '0');
    const totalLido = num(r.valorTotal);
    status.style.color = 'var(--text-dim)';
    if (totalLido !== null && Math.abs(totalLido - totalCalc) > 0.05) {
      msg += ` Atenção: o total na imagem é ${formatBRL(totalLido)} e o calculado é ${formatBRL(totalCalc)}. Confira itens, taxa e desconto.`;
      status.style.color = 'var(--gold)';
    }
    status.textContent = msg;
  }

  // Reduz a imagem para caber no limite de envio do Vercel (~4,5 MB), mantendo texto legível
  // (cupons são longos e estreitos, então o limite é no lado maior, mais generoso que antes).
  function comprimirImagem(file) {
    const tentar = (img, maxDim, qualidade) => {
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.round(width * scale); height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      return canvas.toDataURL('image/jpeg', qualidade).split(',')[1];
    };
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let base64 = tentar(img, 2200, 0.82);
        if (base64.length > 1_000_000) base64 = tentar(img, 1800, 0.7);
        URL.revokeObjectURL(url);
        resolve({ imageBase64: base64, mimeType: 'image/jpeg' });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir essa imagem (formato não suportado?)')); };
      img.src = url;
    });
  }

  renderItensLista();
  renderPagamentosLista();
  document.getElementById('btn-add-pagamento').addEventListener('click', () => {
    sincronizarPagamentosTemp();
    if (pagamentosTemp.length >= MAX_PAGAMENTOS) return;
    pagamentosTemp.push(novoPagamento());
    renderPagamentosLista();
  });
  document.getElementById('btn-add-item').addEventListener('click', () => {
    sincronizarItensTemp();
    itensTemp.push({ id: uid() });
    renderItensLista();
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
      <div class="item-row" style="font-size:11px; color:var(--text-dim); text-transform:uppercase; grid-template-columns: 2fr 1fr 1fr 1fr auto">
        <span>Item (nome genérico)</span><span>Marca (opcional)</span><span>Qtd / Un.</span><span>Preço unit.</span><span></span>
      </div>
      ${itensTemp.map(item => `
      <div class="item-row" data-item-id="${item.id}" style="grid-template-columns: 2fr 1fr 1fr 1fr auto">
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

  function novoPagamento() {
    return { id: uid(), forma: 'dinheiro', valor: '', cartaoId: cartoes[0]?.id || null, parcelado: false, numParcelas: 2, valeTitular: 'Natasha', valeTipo: 'livre', contaSaidaId: '' };
  }

  // Lê o que está na tela em cada forma de pagamento e atualiza pagamentosTemp.
  function sincronizarPagamentosTemp() {
    document.querySelectorAll('[data-pag-id]').forEach(row => {
      const p = pagamentosTemp.find(x => x.id === row.dataset.pagId);
      if (!p) return;
      p.forma = row.querySelector('.p-forma').value;
      p.valor = row.querySelector('.p-valor').value;
      const q = (sel) => row.querySelector(sel);
      if (q('.p-cartao')) p.cartaoId = q('.p-cartao').value;
      if (q('.p-parcelado')) p.parcelado = q('.p-parcelado').value === 'sim';
      if (q('.p-parcelas')) p.numParcelas = parseInt(q('.p-parcelas').value) || 2;
      if (q('.p-vale-titular')) p.valeTitular = q('.p-vale-titular').value;
      if (q('.p-vale-tipo')) p.valeTipo = q('.p-vale-tipo').value;
      if (q('.p-conta')) p.contaSaidaId = q('.p-conta').value;
    });
  }

  function camposExtraPagamento(p) {
    if (p.forma === 'credito') {
      return `
        <div><label>Qual cartão</label>
          <select class="p-cartao">${cartoes.map(c => `<option value="${c.id}" ${p.cartaoId === c.id ? 'selected' : ''}>${formatCartao(c)}</option>`).join('')}</select>
        </div>
        <div><label>Parcelado?</label>
          <select class="p-parcelado"><option value="nao" ${!p.parcelado ? 'selected' : ''}>Não</option><option value="sim" ${p.parcelado ? 'selected' : ''}>Sim</option></select>
        </div>
        ${p.parcelado ? `<div><label>Número de parcelas</label><input type="number" min="2" class="p-parcelas" value="${p.numParcelas || 2}"></div>` : ''}`;
    }
    if (p.forma === 'vale') {
      return `
        <div><label>De quem é o vale</label>
          <select class="p-vale-titular"><option ${p.valeTitular === 'Natasha' ? 'selected' : ''}>Natasha</option><option ${p.valeTitular === 'Daniel' ? 'selected' : ''}>Daniel</option></select>
        </div>
        <div><label>Tipo de saldo</label>
          <select class="p-vale-tipo"><option value="livre" ${p.valeTipo !== 'voucher' ? 'selected' : ''}>Livre</option><option value="voucher" ${p.valeTipo === 'voucher' ? 'selected' : ''}>Voucher</option></select>
        </div>`;
    }
    return `
      <div><label>Conta de saída</label>
        <select class="p-conta">
          <option value="">Selecione a conta</option>
          ${contasDisponiveis.map(c => `<option value="${c.id}" ${p.contaSaidaId === c.id ? 'selected' : ''}>${formatConta(c)}</option>`).join('')}
        </select>
      </div>`;
  }

  function renderPagamentosLista() {
    const el = document.getElementById('pagamentos-lista');
    const unico = pagamentosTemp.length === 1;
    const formas = ['dinheiro', 'debito', 'pix', 'credito', 'vale'];
    el.innerHTML = pagamentosTemp.map(p => `
      <div class="card" data-pag-id="${p.id}" style="margin-bottom:8px; padding:12px">
        <div class="grid grid-4" style="align-items:end">
          <div><label>Forma de pagamento</label>
            <select class="p-forma">${formas.map(f => `<option value="${f}" ${p.forma === f ? 'selected' : ''}>${f === 'vale' ? 'Vale Alimentação' : ROTULO_FORMA[f]}</option>`).join('')}</select>
          </div>
          <div><label>Valor</label>
            <input type="number" step="0.01" class="p-valor" value="${unico ? '' : (p.valor ?? '')}" ${unico ? 'disabled placeholder="Total da compra"' : 'placeholder="0,00"'}>
          </div>
          ${camposExtraPagamento(p)}
          ${unico ? '' : `<div><button class="btn-danger" data-remove-pag="${p.id}">Remover</button></div>`}
        </div>
      </div>
    `).join('');

    el.querySelectorAll('.p-forma, .p-parcelado').forEach(sel => sel.addEventListener('change', () => {
      sincronizarPagamentosTemp();
      renderPagamentosLista();
    }));
    el.querySelectorAll('.p-valor').forEach(inp => inp.addEventListener('input', atualizarTotal));
    el.querySelectorAll('[data-remove-pag]').forEach(btn => btn.addEventListener('click', () => {
      sincronizarPagamentosTemp();
      pagamentosTemp = pagamentosTemp.filter(p => p.id !== btn.dataset.removePag);
      renderPagamentosLista();
    }));
    document.getElementById('btn-add-pagamento').disabled = pagamentosTemp.length >= MAX_PAGAMENTOS;
    atualizarTotal();
  }

  function atualizarStatusPagamentos(total) {
    const st = document.getElementById('pag-status');
    if (!st) return;
    if (pagamentosTemp.length <= 1) { st.textContent = ''; return; }
    let soma = 0;
    document.querySelectorAll('[data-pag-id] .p-valor').forEach(inp => { soma += parseFloat(inp.value) || 0; });
    const dif = Math.round((total - soma) * 100) / 100;
    st.textContent = dif === 0 ? 'Os pagamentos batem com o total.' : dif > 0 ? `Faltam ${formatBRL(dif)} para alocar.` : `Passou ${formatBRL(-dif)} do total.`;
    st.style.color = dif === 0 ? 'var(--olive)' : 'var(--terracota)';
  }

  function atualizarTotal() {
    let total = 0;
    document.querySelectorAll('[data-item-id]').forEach(row => {
      const qtd = parseFloat(row.querySelector('.i-qtd').value) || 0;
      const preco = parseFloat(row.querySelector('.i-preco').value) || 0;
      total += qtd * preco;
    });
    const taxa = parseFloat(document.getElementById('m-taxa')?.value) || 0;
    const desconto = parseFloat(document.getElementById('m-desconto')?.value) || 0;
    total = Math.max(0, total + taxa - desconto);
    document.getElementById('m-total-display').textContent = formatBRL(total);
    document.getElementById('m-total-display').dataset.valor = total;
    atualizarStatusPagamentos(total);
  }

  function resetForm() {
    editandoId = null;
    edicaoOriginal = null;
    itensTemp = [{ id: uid() }];
    pagamentosTemp = [novoPagamento()];
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
    edicaoOriginal = { pagamentos: getPagamentos(compra), itens: compra.itens || [] };
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
    pagamentosTemp = getPagamentos(compra).filter(p => ROTULO_FORMA[p.forma]).map(p => ({ ...novoPagamento(), ...p, id: p.id === 'legado' ? uid() : p.id }));
    if (!pagamentosTemp.length) pagamentosTemp = [novoPagamento()];

    itensTemp = (compra.itens || []).map(i => ({ id: uid(), ...i }));
    renderItensLista();
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

    sincronizarPagamentosTemp();
    const round2 = (n) => Math.round(n * 100) / 100;
    const pagamentos = [];
    for (const p of pagamentosTemp) {
      const valor = pagamentosTemp.length === 1 ? round2(valorTotal) : round2(parseFloat(p.valor) || 0);
      if (valor <= 0) { alert('Informe o valor de cada forma de pagamento.'); return; }
      if (FORMAS_A_VISTA.includes(p.forma) && !p.contaSaidaId) { alert('Selecione de qual conta saiu o pagamento em ' + ROTULO_FORMA[p.forma] + '.'); return; }
      if (p.forma === 'credito' && !p.cartaoId) { alert('Selecione o cartão do pagamento no crédito.'); return; }
      const credito = p.forma === 'credito';
      const parcelado = credito && !!p.parcelado;
      pagamentos.push({
        id: p.id, forma: p.forma, valor,
        cartaoId: credito ? p.cartaoId : null,
        parcelado,
        numParcelas: parcelado ? (parseInt(p.numParcelas) || 2) : 1,
        valeTitular: p.forma === 'vale' ? p.valeTitular : null,
        valeTipo: p.forma === 'vale' ? (p.valeTipo || 'livre') : null,
        contaSaidaId: FORMAS_A_VISTA.includes(p.forma) ? p.contaSaidaId : null
      });
    }
    const somaPagamentos = round2(pagamentos.reduce((s, p) => s + p.valor, 0));
    if (Math.abs(somaPagamentos - round2(valorTotal)) > 0.009) {
      alert(`A soma das formas de pagamento (${formatBRL(somaPagamentos)}) precisa ser igual ao total da compra (${formatBRL(valorTotal)}).`);
      return;
    }

    // Campos antigos (forma única) ficam zerados; a fonte de verdade agora é "pagamentos".
    const payload = {
      data, mercado, modalidade, taxaEntrega, desconto, valorTotal, itens, pagamentos,
      formaPagamento: pagamentos.length > 1 ? 'misto' : pagamentos[0].forma,
      cartaoId: null, parcelado: false, numParcelas: 1, valeTitular: null, valeTipo: null, contaSaidaId: null
    };

    let compraId;
    if (editandoId) {
      compraId = editandoId;
      await updateDoc(doc(db, 'mercadoCompras', compraId), payload);
      for (const p of (edicaoOriginal?.pagamentos || [])) {
        if (FORMAS_A_VISTA.includes(p.forma) && p.contaSaidaId) await ajustarSaldoConta(p.contaSaidaId, p.valor);
      }
      // Ajusta a Despensa pela diferença entre os itens antigos e os novos
      const gruposAntigos = agruparItensPorChave(edicaoOriginal?.itens || []);
      const gruposNovos = agruparItensPorChave(itens);
      const chaves = new Set([...Object.keys(gruposAntigos), ...Object.keys(gruposNovos)]);
      const snapDespensa = await new Promise(res => { const u = onSnapshot(query(despensaCol), s => { res(s); u(); }); });
      for (const chave of chaves) {
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
      }
    } else {
      const ref = await addDoc(comprasCol, payload);
      compraId = ref.id;
      // Todo item comprado vai automaticamente para a Despensa (agrupado por nome+marca, corrige duplicatas na mesma compra)
      const grupos = agruparItensPorChave(itens);
      for (const grupo of Object.values(grupos)) {
        await upsertDespensaItem({ nome: grupo.nome, marca: grupo.marca, quantidade: grupo.quantidade, unidade: grupo.unidade, dataCompra: data });
      }
    }

    // Um lançamento no cartão por forma de pagamento em crédito (refaz do zero a cada salvamento)
    await removerLancamentosEspelhoDaOrigem('mercado', compraId);
    for (const p of pagamentos.filter(p => p.forma === 'credito')) {
      await upsertLancamentoEspelho({
        origem: 'mercado', origemId: `${compraId}#${p.id}`, cartaoId: p.cartaoId, valorTotal: p.valor,
        parcelado: p.parcelado, numParcelas: p.numParcelas, data,
        descricao: `Compra de mercado (${mercado})`, categoria: 'Mercado'
      });
    }

    let saldoNegativo = false;
    for (const p of pagamentos.filter(p => p.contaSaidaId)) {
      const novoSaldo = await ajustarSaldoConta(p.contaSaidaId, -p.valor);
      if (novoSaldo !== null && novoSaldo < 0) saldoNegativo = true;
    }
    if (saldoNegativo) alert('Compra registrada. Atenção: o saldo de uma das contas ficou negativo.');

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
      const semForma = compras.filter(semPagamentoReconhecido);
      const painelLote = semForma.length ? `
        <div class="card" style="margin-bottom:12px; padding:12px">
          <strong>${semForma.length} compra(s) sem forma de pagamento reconhecida.</strong>
          <p style="color:var(--text-dim); font-size:13px; margin:4px 0 8px">Marque as que foram pagas no vale e aplique. Elas passam a descontar do saldo do vale e saem do total gasto do casal.</p>
          <div class="grid grid-3" style="align-items:end">
            <div><label>De quem é o vale</label><select id="lote-titular"><option>Natasha</option><option>Daniel</option></select></div>
            <div><label>Tipo de saldo</label><select id="lote-tipo"><option value="livre">Livre</option><option value="voucher">Voucher</option></select></div>
            <div><button class="btn-primary" id="lote-aplicar">Aplicar vale nas marcadas</button></div>
          </div>
        </div>` : '';
      el.innerHTML = painelLote + `
        <table>
          <thead><tr><th>Data</th><th>Mercado</th><th>Modalidade</th><th>Pagamento</th><th>Valor</th><th></th></tr></thead>
          <tbody>
            ${compras.map(c => `
              <tr>
                <td>${formatDate(c.data)}</td>
                <td>${c.mercado}</td>
                <td>${c.modalidade === 'online' ? 'Online (iFood)' : 'Presencial'}</td>
                <td>${semPagamentoReconhecido(c) ? `<label style="white-space:nowrap"><input type="checkbox" data-lote="${c.id}"> Vale (${resumoPagamentos(c)})</label>` : resumoPagamentos(c)}</td>
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
      document.getElementById('lote-aplicar')?.addEventListener('click', async () => {
        const marcadas = Array.from(el.querySelectorAll('[data-lote]:checked')).map(i => compras.find(c => c.id === i.dataset.lote)).filter(Boolean);
        if (!marcadas.length) { alert('Marque pelo menos uma compra.'); return; }
        const valeTitular = document.getElementById('lote-titular').value;
        const valeTipo = document.getElementById('lote-tipo').value;
        if (!confirm(`Marcar ${marcadas.length} compra(s) como pagas no vale (${valeTitular} · ${valeTipo})?`)) return;
        for (const c of marcadas) {
          await updateDoc(doc(db, 'mercadoCompras', c.id), {
            formaPagamento: 'vale', cartaoId: null, parcelado: false, numParcelas: 1, valeTitular, valeTipo, contaSaidaId: null,
            pagamentos: [{ id: uid(), forma: 'vale', valor: c.valorTotal || 0, cartaoId: null, parcelado: false, numParcelas: 1, valeTitular, valeTipo, contaSaidaId: null }]
          });
        }
      });
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
          if (compra) {
            for (const p of getPagamentos(compra)) {
              if (FORMAS_A_VISTA.includes(p.forma) && p.contaSaidaId) await ajustarSaldoConta(p.contaSaidaId, p.valor);
            }
          }
          await deleteDoc(doc(db, 'mercadoCompras', btn.dataset.del));
          await removerLancamentosEspelhoDaOrigem('mercado', btn.dataset.del);
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
