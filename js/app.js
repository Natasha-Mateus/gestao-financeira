import { auth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from './firebase-config.js';

import { renderDashboard } from './modules/dashboard.js';
import { renderContasFixas } from './modules/contasFixas.js';
import { renderVariaveis } from './modules/variaveis.js';
import { renderMercadoCompra, renderMercadoEmUso, renderMercadoLista } from './modules/mercado.js';
import { renderCartaoCartoes, renderCartaoVale, renderCartaoLancamentos, renderCartaoFaturas } from './modules/cartao.js';
import { renderRenda } from './modules/renda.js';

const loginScreen = document.getElementById('login-screen');
const appShell = document.getElementById('app-shell');
const mainContent = document.getElementById('main-content');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const sidebar = document.getElementById('sidebar');

const routes = {
  dashboard: renderDashboard,
  contasFixas: renderContasFixas,
  variaveis: renderVariaveis,
  'mercado.compra': renderMercadoCompra,
  'mercado.emUso': renderMercadoEmUso,
  'mercado.lista': renderMercadoLista,
  'cartao.cartoes': renderCartaoCartoes,
  'cartao.vale': renderCartaoVale,
  'cartao.lancamentos': renderCartaoLancamentos,
  'cartao.faturas': renderCartaoFaturas,
  renda: renderRenda
};

const PARENTS = ['mercado', 'cartao'];

let currentRoute = 'dashboard';
let currentUnsubscribers = [];

function cleanupRoute() {
  currentUnsubscribers.forEach(fn => { try { fn(); } catch (e) {} });
  currentUnsubscribers = [];
}

function setActiveNav(route) {
  document.querySelectorAll('.nav-item[data-route]').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });
  document.querySelectorAll('.nav-subitem').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });
  PARENTS.forEach(parent => {
    if (route.startsWith(`${parent}.`)) {
      document.querySelector(`.nav-parent[data-parent="${parent}"]`).classList.add('open');
      document.getElementById(`submenu-${parent}`).classList.add('open');
    }
  });
}

async function loadRoute(route) {
  cleanupRoute();
  currentRoute = route;
  setActiveNav(route);
  mainContent.innerHTML = '<p style="color:#A5A9B3">Carregando...</p>';
  const renderFn = routes[route];
  const unsubs = await renderFn(mainContent);
  if (Array.isArray(unsubs)) currentUnsubscribers = unsubs;
}

document.querySelectorAll('.nav-item[data-route]').forEach(el => {
  el.addEventListener('click', () => loadRoute(el.dataset.route));
});

document.querySelectorAll('.nav-subitem[data-route]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    loadRoute(el.dataset.route);
  });
});

PARENTS.forEach(parent => {
  document.querySelector(`.nav-parent[data-parent="${parent}"]`).addEventListener('click', () => {
    const submenu = document.getElementById(`submenu-${parent}`);
    const parentEl = document.querySelector(`.nav-parent[data-parent="${parent}"]`);
    const isOpen = submenu.classList.contains('open');
    const firstSubRoute = document.querySelector(`#submenu-${parent} .nav-subitem`).dataset.route;
    if (!isOpen) {
      submenu.classList.add('open');
      parentEl.classList.add('open');
      loadRoute(firstSubRoute);
    } else if (currentRoute.startsWith(`${parent}.`)) {
      submenu.classList.remove('open');
      parentEl.classList.remove('open');
    } else {
      loadRoute(firstSubRoute);
    }
  });
});

document.getElementById('collapse-btn').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');

function openMobileMenu() {
  sidebar.classList.add('mobile-open');
  sidebarOverlay.classList.add('open');
}
function closeMobileMenu() {
  sidebar.classList.remove('mobile-open');
  sidebarOverlay.classList.remove('open');
}
mobileMenuBtn.addEventListener('click', openMobileMenu);
sidebarOverlay.addEventListener('click', closeMobileMenu);
document.querySelectorAll('.nav-item[data-route], .nav-subitem[data-route]').forEach(el => {
  el.addEventListener('click', closeMobileMenu);
});

document.getElementById('logout-btn').addEventListener('click', () => {
  cleanupRoute();
  signOut(auth);
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = 'E-mail ou senha inválidos.';
    loginError.style.display = 'block';
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.style.display = 'none';
    appShell.classList.add('active');
    loadRoute(currentRoute);
  } else {
    cleanupRoute();
    appShell.classList.remove('active');
    loginScreen.style.display = 'flex';
  }
});
