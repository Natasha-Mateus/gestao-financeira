export function formatBRL(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

export function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function currentMonthRef() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthRefFromDate(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : currentMonthRef();
}

export function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export const CATEGORIAS_GASTOS = [
  'Mercado',
  'Delivery',
  'Lazer',
  'Vestuário',
  'Saúde',
  'Casa',
  'Transporte',
  'Educação',
  'Outros'
];

export function renderMonthSelector(currentSelectedMonth, onMonthChange) {
  const container = document.createElement('div');
  container.className = 'month-selector-bar';
  
  const [yearStr, monthStr] = currentSelectedMonth.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10);

  const monthsNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  function getMonthText() {
    return `${monthsNames[month - 1]} de ${year}`;
  }

  container.innerHTML = `
    <button class="btn-month-nav" id="btn-prev-month" title="Mês Anterior">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    <div class="month-display-label">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <span id="month-text-val">${getMonthText()}</span>
      <input type="month" id="month-picker-input" value="${currentSelectedMonth}" style="position:absolute; opacity:0; width:100%; height:100%; top:0; left:0; cursor:pointer;">
    </div>
    <button class="btn-month-nav" id="btn-next-month" title="Próximo Mês">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  `;

  setTimeout(() => {
    const prevBtn = container.querySelector('#btn-prev-month');
    const nextBtn = container.querySelector('#btn-next-month');
    const inputPicker = container.querySelector('#month-picker-input');
    const textLabel = container.querySelector('#month-text-val');

    prevBtn.addEventListener('click', () => {
      month--;
      if (month < 1) { month = 12; year--; }
      const newRef = `${year}-${String(month).padStart(2, '0')}`;
      textLabel.textContent = getMonthText();
      inputPicker.value = newRef;
      onMonthChange(newRef);
    });

    nextBtn.addEventListener('click', () => {
      month++;
      if (month > 12) { month = 1; year++; }
      const newRef = `${year}-${String(month).padStart(2, '0')}`;
      textLabel.textContent = getMonthText();
      inputPicker.value = newRef;
      onMonthChange(newRef);
    });

    inputPicker.addEventListener('change', (e) => {
      if (!e.target.value) return;
      const [y, m] = e.target.value.split('-');
      year = parseInt(y, 10);
      month = parseInt(m, 10);
      textLabel.textContent = getMonthText();
      onMonthChange(e.target.value);
    });
  }, 0);

  return container;
}

export function renderFormToggleHeader(titleText, formContainerId) {
  return `
    <div class="form-toggle-header">
      <h3 style="margin:0">${titleText}</h3>
      <button class="btn-toggle-form" data-target="${formContainerId}">
        <span class="toggle-icon">▲</span>
        <span class="toggle-text">Ocultar Formulário</span>
      </button>
    </div>
  `;
}

export function setupFormToggleListeners(parentEl) {
  parentEl.querySelectorAll('.btn-toggle-form').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const targetEl = parentEl.querySelector(`#${targetId}`);
      if (!targetEl) return;
      const isHidden = targetEl.classList.contains('form-collapsed');
      if (isHidden) {
        targetEl.classList.remove('form-collapsed');
        btn.querySelector('.toggle-icon').textContent = '▲';
        btn.querySelector('.toggle-text').textContent = 'Ocultar Formulário';
      } else {
        targetEl.classList.add('form-collapsed');
        btn.querySelector('.toggle-icon').textContent = '▼';
        btn.querySelector('.toggle-text').textContent = 'Mostrar Formulário';
      }
    });
  });
}
