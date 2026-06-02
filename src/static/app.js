// Navegação entre páginas via DOM e inicialização dos módulos

// AUTENTICAÇÃO

function getToken() {
    return sessionStorage.getItem('sad_token');
}

function getUsuario() {
    const u = sessionStorage.getItem('sad_usuario');
    return u ? JSON.parse(u) : null;
}

function salvarSessao(token, usuario) {
    sessionStorage.setItem('sad_token', token);
    sessionStorage.setItem('sad_usuario', JSON.stringify(usuario));
}

function limparSessao() {
    sessionStorage.removeItem('sad_token');
    sessionStorage.removeItem('sad_usuario');
}

// Fetch autenticado - envia token em todas as requisições
async function fetchAuth(url, options = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
    const resposta = await fetch(url, { ...options, headers });
    if (resposta.status === 401) {
        limparSessao();
        mostrarLogin();
        throw new Error('Sessão expirada');
    }
    return resposta;
}

// Substitui o fetch global para todas as chamadas da interface
window.fetchAuth = fetchAuth;

// TELA DE LOGIN

function mostrarLogin() {
    document.getElementById('app').style.display = 'none';
    document.getElementById('tela-login').style.display = 'flex';
}

function mostrarApp() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
}

async function fazerLogin() {
    const login = document.getElementById('login-input').value.trim();
    const senha = document.getElementById('senha-input').value;
    const erro  = document.getElementById('login-erro');

    if (!login || !senha) {
        erro.textContent = 'Preencha login e senha.';
        return;
    }

    erro.textContent = '';
    document.getElementById('btn-login').disabled = true;

    try {
        const resposta = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `username=${encodeURIComponent(login)}&password=${encodeURIComponent(senha)}`
        });

        if (!resposta.ok) {
            erro.textContent = 'Login ou senha inválidos.';
            return;
        }

        const dados = await resposta.json();
        salvarSessao(dados.access_token, {
            nome:   dados.nome,
            perfil: dados.perfil,
            login
        });

        mostrarApp();
        inicializarInterface();

    } catch (e) {
        erro.textContent = 'Erro de conexão.';
    } finally {
        document.getElementById('btn-login').disabled = false;
    }
}

function fazerLogout() {
    limparSessao();
    mostrarLogin();
}

// MENU DE USUÁRIO

function renderizarMenuUsuario() {
    const usuario = getUsuario();
    if (!usuario) return;

    const container = document.getElementById('usuario-menu');
    container.innerHTML = `
        <div class="usuario-btn" onclick="toggleMenuUsuario()">
            <span class="usuario-icone">👤</span>
            <span class="usuario-nome">${usuario.nome.split(' ')[0]}</span>
            <span class="usuario-seta">▾</span>
        </div>
        <div class="usuario-dropdown" id="usuario-dropdown" style="display:none">
            <div class="usuario-info">
                <strong>${usuario.nome}</strong>
                <small>${usuario.perfil === 'admin' ? 'Administrador' : 'Gestor'}</small>
            </div>
            <hr class="usuario-divider">
            <button class="usuario-opcao" onclick="fazerLogout()">Sair</button>
        </div>
    `;

    // Aba de usuários visível só para admin
    const menuAdmin = document.getElementById('menu-item-usuarios');
    if (menuAdmin) {
        menuAdmin.style.display = usuario.perfil === 'admin' ? 'block' : 'none';
    }
}

function toggleMenuUsuario() {
    const dd = document.getElementById('usuario-dropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

// Fecha dropdown ao clicar fora
document.addEventListener('click', (e) => {
    const menu = document.getElementById('usuario-menu');
    if (menu && !menu.contains(e.target)) {
        const dd = document.getElementById('usuario-dropdown');
        if (dd) dd.style.display = 'none';
    }
});

// INICIALIZAÇÃO

function inicializarInterface() {
    renderizarMenuUsuario();
    carregarPagina('lista-os');

    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            carregarPagina(item.getAttribute('data-pagina'));
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Bind do formulário de login
    document.getElementById('btn-login').addEventListener('click', fazerLogin);
    document.getElementById('senha-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') fazerLogin();
    });

    // Verifica se já tem sessão ativa
    if (getToken()) {
        mostrarApp();
        inicializarInterface();
    } else {
        mostrarLogin();
    }
});

function carregarPagina(nomePagina) {
    document.querySelectorAll('.pagina').forEach(p => p.classList.remove('ativa'));
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('ativo'));

    const pagina = document.getElementById(`pagina-${nomePagina}`);
    if (pagina) pagina.classList.add('ativa');

    const menuItem = document.querySelector(`[data-pagina="${nomePagina}"]`);
    if (menuItem) menuItem.classList.add('ativo');

    const inicializadores = {
        'lista-os':     () => typeof inicializarListaOS      === 'function' && inicializarListaOS(),
        'mapa':         () => typeof inicializarMapa         === 'function' && inicializarMapa(),
        'configuracao': () => typeof inicializarConfiguracao === 'function' && inicializarConfiguracao(),
        'atribuicao':   () => typeof inicializarAtribuicao   === 'function' && inicializarAtribuicao(),
        'dashboard':    () => typeof inicializarDashboard    === 'function' && inicializarDashboard(),
        'usuarios':     () => typeof inicializarUsuarios     === 'function' && inicializarUsuarios(),
    };

    if (inicializadores[nomePagina]) inicializadores[nomePagina]();
}