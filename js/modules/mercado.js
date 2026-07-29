import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, formatDate, todayISO, daysBetween, uid } from '../helpers.js';
import { getCartoes, upsertLancamentoDeMercado } from './cartao.js';

const comprasCol = collection(db, 'mercadoCompras');
const itensEmUsoCol = collection(db, 'itensEmUso');
const listaComprasCol = collection(db, 'listaCompras');

const CATEGORIAS = ['Limpeza', 'Higiene', 'Alimentos', 'Bebidas', 'Hortifruti', 'Açougue', 'Padaria', 'Pet', 'Outros'];
const UNIDADES = ['un', 'kg', 'litro', 'pacote'];

// ==================== SUBMÓDULO: COMPRA ====================
export async function renderMercadoCompra(container) {
  const unsubs = [];
  const cartoes = await getCartoes();
  let itensTemp = [{ id: uid() }];

  container.innerHTML = `
    <h2 class="module-title">Mercado · Compra</h2>

    <div class="card" style="margin-bottom:24px">
      <h3>Nova compra</h3>
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
          <select id="m-cartao">${cartoes.map(c => `<option value="${c.id}">${c.apelido}</option>`).join('')}</select>
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
      </div>
    </div>

    <div class="card" style="margin-bottom:24px">
      <h3>Escanear cupom (IA)</h3>
      <p style="color:var(--text-dim); font-size:13px; margin-top:0">Tire uma foto do cupom fiscal ou nota — a IA tenta preencher os itens abaixo. Revise sempre antes de salvar.</p>
      <input type="file" id="input-foto-cupom" accept="image/*" capture="environment" style="display:none">
      <button class="btn-ghost" id="btn-escanear-cupom">📷 Tirar foto / escolher imagem</button>
      <span id="scan-status" style="margin-left:12px; color:var(--text-dim); font-size:13px"></span>
    </div>

    <div class="card" style="margin-bottom:24px">
      <h3>Itens</h3>
      <div id="itens-lista" style="margin-top:16px"></div>
      <button class="btn-ghost" id="btn-add-item" style="margin-top:8px">+ Adicionar item</button>
    </div>

    <div class="card" style="display:flex; justify-content:space-between; align-items:center">
      <div>
        <div class="label" style="color:var(--text-dim); font-size:12px; text-transform:uppercase">Valor total</div>
        <div class="display" style="font-size:24px; color:var(--gold)" id="m-total-display">R$ 0,00</div>
      </div>
      <button class="btn" id="btn-salvar-compra">Salvar compra</button>
    </div>
  `;

  document.getElementById('m-modalidade').addEventListener('change', (e) => {
    document.getElementById('m-taxa-wrap').classList.toggle('show', e.target.value === 'online');
  });

  document.getElementById('m-forma-pagamento').addEventListener('change', (e) => {
    const isCredito = e.target.value === 'credito';
    const isVale = e.target.value === 'vale';
    document.getElementById('m-cartao-wrap').classList.toggle('show', isCredito);
    document.getElementById('m-parcelado-wrap').classList.toggle('show', isCredito);
    document.getElementById('m-vale-titular-wrap').classList.toggle('show', isVale);
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType })
      });
      const resultado = await resp.json();
      if (!resp.ok) {
        status.textContent = 'Não consegui ler o cupom. Preencha manualmente.';
        console.error(resultado);
        return;
      }
      if (resultado.mercado && !document.getElementById('m-mercado').value) {
        document.getElementById('m-mercado').value = resultado.mercado;
      }
      if (Array.isArray(resultado.itens) && resultado.itens.length) {
        itensTemp = resultado.itens.map(item => ({
          id: uid(),
          nome: item.nome || '',
          quantidade: item.quantidade ?? '',
          precoUnitario: item.precoUnitario ?? '',
          lidoPorIA: true
        }));
        renderItensLista();
        status.textContent = `${resultado.itens.length} item(ns) lido(s). Revise antes de salvar.`;
      } else {
        status.textContent = 'A IA não encontrou itens legíveis nessa foto.';
      }
    } catch (err) {
      status.textContent = 'Erro ao processar a imagem.';
      console.error(err);
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
            width *= scale;
            height *= scale;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
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

  function renderItensLista() {
    const el = document.getElementById('itens-lista');
    el.innerHTML = `
      <div class="item-row" style="font-size:11px; color:var(--text-dim); text-transform:uppercase">
        <span>Item</span><span>Categoria</span><span>Qtd / Un.</span><span>Preço unit.</span><span>Recorrente</span><span></span>
      </div>
      ${itensTemp.map(item => `
      <div class="item-row" data-item-id="${item.id}">
        <div style="display:flex; align-items:center; gap:6px">
          <input type="text" class="i-nome" placeholder="Nome do item" value="${item.nome || ''}">
          ${item.lidoPorIA ? '<span class="tag" title="Preenchido pela IA, revise">IA</span>' : ''}
        </div>
        <select class="i-categoria">${CATEGORIAS.map(c => `<option ${item.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <div style="display:flex; gap:4px">
          <input type="number" class="i-qtd" placeholder="Qtd" style="width:60px" value="${item.quantidade ?? ''}">
          <select class="i-unidade">${UNIDADES.map(u => `<option ${item.unidade === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
        </div>
        <input type="number" step="0.01" class="i-preco" placeholder="0,00" value="${item.precoUnitario ?? ''}">
        <select class="i-recorrente"><option value="sim" ${item.recorrente === true ? 'selected' : ''}>Sim</option><option value="nao" ${item.recorrente !== true ? 'selected' : ''}>Não</option></select>
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

    const itens = [];
    document.querySelectorAll('[data-item-id]').forEach(row => {
      const nome = row.querySelector('.i-nome').value;
      if (!nome) return;
      const qtd = parseFloat(row.querySelector('.i-qtd').value) || 0;
      const preco = parseFloat(row.querySelector('.i-preco').value) || 0;
      itens.push({
        nome,
        categoria: row.querySelector('.i-categoria').value,
        quantidade: qtd,
        unidade: row.querySelector('.i-unidade').value,
        precoUnitario: preco,
        precoTotal: qtd * preco,
        recorrente: row.querySelector('.i-recorrente').value === 'sim'
      });
    });

    if (!itens.length) { alert('Adicione pelo menos um item.'); return; }

    const valorTotal = itens.reduce((s, i) => s + i.precoTotal, 0) + taxaEntrega;

    const compraRef = await addDoc(comprasCol, {
      data, mercado, modalidade, taxaEntrega, formaPagamento, cartaoId, parcelado, numParcelas, valeTitular, valorTotal, itens
    });

    for (const item of itens) {
      if (item.recorrente) {
        await addDoc(itensEmUsoCol, {
          itemNome: item.nome,
          categoria: item.categoria,
          compraId: compraRef.id,
          dataCompra: data,
          status: 'em_uso',
          dataAcabou: null
        });
      }
    }

    if (formaPagamento === 'credito') {
      await upsertLancamentoDeMercado({ mercadoCompraId: compraRef.id, cartaoId, valorTotal, parcelado, numParcelas, data });
    }

    alert('Compra salva com sucesso!');
    renderMercadoCompra(container);
  }

  return unsubs;
}

// ==================== SUBMÓDULO: ITENS EM USO ====================
export function renderMercadoEmUso(container) {
  const unsubs = [];
  container.innerHTML = `
    <h2 class="module-title">Mercado · Itens em uso</h2>
    <div id="lista-em-uso"></div>
  `;

  const unsub = onSnapshot(query(itensEmUsoCol), (snap) => {
    const itens = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const emUso = itens.filter(i => i.status === 'em_uso').sort((a, b) => a.dataCompra.localeCompare(b.dataCompra));
    const el = document.getElementById('lista-em-uso');
    if (!emUso.length) {
      el.innerHTML = '<div class="empty-state">Nenhum item marcado como recorrente em uso no momento.</div>';
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>Item</th><th>Categoria</th><th>Comprado em</th><th>Dias em uso</th><th></th></tr></thead>
        <tbody>
          ${emUso.map(i => `
            <tr>
              <td>${i.itemNome}</td>
              <td><span class="tag">${i.categoria}</span></td>
              <td>${formatDate(i.dataCompra)}</td>
              <td>${daysBetween(i.dataCompra, todayISO())} dias</td>
              <td><button class="btn-ghost" data-acabou="${i.id}">Marcar como acabou</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    el.querySelectorAll('[data-acabou]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = emUso.find(i => i.id === btn.dataset.acabou);
        await updateDoc(doc(db, 'itensEmUso', item.id), { status: 'acabou', dataAcabou: todayISO() });
        await addDoc(listaComprasCol, {
          tipo: 'auto', nome: item.itemNome, categoria: item.categoria, comprado: false, criadoEm: todayISO()
        });
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
      <h3>Adicionar item livre</h3>
      <div style="display:flex; gap:8px; margin-top:12px">
        <input type="text" id="livre-nome" placeholder="Nome do item" style="margin-bottom:0">
        <button class="btn" id="btn-add-livre">Adicionar</button>
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
