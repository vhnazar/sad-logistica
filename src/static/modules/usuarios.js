// Gerenciamento de usuários (visível apenas para admin)

function inicializarUsuarios() {
    renderizarEstruturaUsuarios();
    carregarUsuarios();
}

function renderizarEstruturaUsuarios() {
    const pagina = document.getElementById('pagina-usuarios');
    if (pagina.querySelector('.usuarios-container')) return;

    pagina.innerHTML = `
        <div class="usuarios-container">
            <div class="usuarios-header">
                <h1>Gerenciar Usuários</h1>
                <button class="btn-atualizar" onclick="carregarUsuarios()">Atualizar</button>
            </div>

            <div class="config-secao">
                <div class="config-secao-header">
                    <h2>Usuários cadastrados</h2>
                    <button class="btn-nova-regra" onclick="abrirModalNovoUsuario()">+ Novo usuário</button>
                </div>
                <div id="usuarios-lista">
                    <div class="carregando">Carregando...</div>
                </div>
            </div>
        </div>
    `;
}

async function carregarUsuarios() {
    const lista = document.getElementById('usuarios-lista');
    if (!lista) return;
    lista.innerHTML = '<div class="carregando">Carregando...</div>';

    try {
        const resposta = await fetchAuth('/auth/usuarios');
        const usuarios = await resposta.json();

        if (usuarios.length === 0) {
            lista.innerHTML = '<div class="vazio">Nenhum usuário cadastrado.</div>';
            return;
        }

        lista.innerHTML = usuarios.map(u => `
            <div class="regra-card">
                <div class="regra-card-info">
                    <div class="regra-nome">${u.nome}</div>
                    <div class="regra-meta">
                        <span>Login: <strong>${u.login}</strong></span>
                        <span class="condicao-tag">${u.perfil === 'admin' ? 'Administrador' : 'Gestor'}</span>
                        <span class="${u.ativo ? 'badge-sucesso' : 'badge-cancelado'} badge">
                            ${u.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                    </div>
                    <div class="regra-prioridade">Cadastrado em: ${new Date(u.criado_em).toLocaleDateString('pt-BR')}</div>
                </div>
                <div class="regra-card-acoes">
                    <label class="toggle" title="${u.ativo ? 'Desativar' : 'Ativar'}">
                        <input type="checkbox" ${u.ativo ? 'checked' : ''} onchange="toggleUsuario(${u.id})">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>
        `).join('');

    } catch (erro) {
        lista.innerHTML = `<div class="erro">Erro ao carregar usuários: ${erro.message}</div>`;
    }
}

async function toggleUsuario(id) {
    try {
        await fetchAuth(`/auth/usuarios/${id}/ativo`, { method: 'PATCH' });
        mostrarNotificacao('Status atualizado.', 'sucesso');
        carregarUsuarios();
    } catch (erro) {
        mostrarNotificacao('Erro ao atualizar status.', 'erro');
    }
}

function abrirModalNovoUsuario() {
    document.getElementById('modal-novo-usuario')?.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-novo-usuario';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>Novo Usuário</h3>
                <button class="modal-fechar" onclick="document.getElementById('modal-novo-usuario').remove()">✕</button>
            </div>
            <div class="modal-body">
                <label>Nome completo</label>
                <input type="text" id="novo-nome" class="modal-input" placeholder="Nome do usuário" />

                <label>Login</label>
                <input type="text" id="novo-login" class="modal-input" placeholder="login.usuario" />

                <label>Senha</label>
                <input type="password" id="novo-senha" class="modal-input" placeholder="Mínimo 6 caracteres" />

                <label>Perfil</label>
                <select id="novo-perfil" class="filtro-select" style="width:100%">
                    <option value="gestor">Gestor</option>
                    <option value="admin">Administrador</option>
                </select>
            </div>
            <div class="modal-footer">
                <button class="btn-cancelar" onclick="document.getElementById('modal-novo-usuario').remove()">Cancelar</button>
                <button class="btn-confirmar" onclick="confirmarNovoUsuario()">Criar usuário</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => document.getElementById('novo-nome').focus(), 50);
}

async function confirmarNovoUsuario() {
    const nome   = document.getElementById('novo-nome').value.trim();
    const login  = document.getElementById('novo-login').value.trim();
    const senha  = document.getElementById('novo-senha').value;
    const perfil = document.getElementById('novo-perfil').value;

    if (!nome || !login || !senha) {
        mostrarNotificacao('Preencha todos os campos.', 'aviso');
        return;
    }

    if (senha.length < 6) {
        mostrarNotificacao('Senha deve ter ao menos 6 caracteres.', 'aviso');
        return;
    }

    try {
        const resposta = await fetchAuth('/auth/usuarios', {
            method: 'POST',
            body: JSON.stringify({ nome, login, senha, perfil })
        });
        const resultado = await resposta.json();

        if (resultado.sucesso) {
            document.getElementById('modal-novo-usuario').remove();
            mostrarNotificacao(`Usuário "${nome}" criado com sucesso.`, 'sucesso');
            carregarUsuarios();
        } else {
            mostrarNotificacao(resultado.detail || 'Erro ao criar usuário.', 'erro');
        }
    } catch (erro) {
        mostrarNotificacao('Erro ao criar usuário.', 'erro');
    }
}