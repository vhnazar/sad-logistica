// Gerenciamento de regras de atribuição automática

let regrasCarregadas = [];
let presetsCarregados = [];
let operadoresCarregados = [];

function inicializarConfiguracao() {
    renderizarEstruturaConfig();
    carregarTudo();
}

function renderizarEstruturaConfig() {
    const pagina = document.getElementById('pagina-configuracao');
    
    if (!pagina) {
        return;
    }
    
    if (pagina.querySelector('.config-container')) {
        return;
    }

    pagina.innerHTML = `
        <div class="config-container">

            <div class="config-header">
                <h1>Configuração de Atribuição</h1>
                <button class="btn-atualizar" onclick="carregarTudo()">Atualizar</button>
            </div>

            <!-- Regras ativas -->
            <div class="config-secao">
                <div class="config-secao-header">
                    <h2>Regras Ativas</h2>
                    <button class="btn-nova-regra" onclick="abrirModalNovaRegra()">
                        + Nova regra
                    </button>
                </div>
                <div id="regras-lista">
                    <div class="carregando">Carregando regras...</div>
                </div>
            </div>

            <!-- Presets -->
            <div class="config-secao">
                <div class="config-secao-header">
                    <h2>Presets disponíveis</h2>
                </div>
                <div id="presets-lista">
                    <div class="carregando">Carregando presets...</div>
                </div>
            </div>

        </div>

        <!-- Modal nova regra -->
        <div id="modal-nova-regra" class="modal-overlay" style="display:none">
            <div class="modal modal-regra">
                <div class="modal-header">
                    <h3 id="modal-regra-titulo">Nova Regra</h3>
                    <button class="modal-fechar" onclick="fecharModalRegra()">✕</button>
                </div>
                <div class="modal-body">

                    <label>Nome da regra</label>
                    <input type="text" id="regra-nome" class="modal-input" placeholder="Ex: Score baixo - auto atribuir"/>

                    <div class="regra-form-row">
                        <div>
                            <label>Modo</label>
                            <select id="regra-modo" class="modal-input" onchange="toggleOperadorFixo()">
                                <option value="automatico">Automático (usa sugestão do motor)</option>
                                <option value="fixo">Fixo (operador específico)</option>
                            </select>
                        </div>
                        <div>
                            <label>Prioridade</label>
                            <input type="number" id="regra-prioridade" class="modal-input" value="0" min="0"/>
                        </div>
                    </div>

                    <div id="campo-operador-fixo" style="display:none">
                        <label>Matrícula do operador fixo</label>
                        <input type="number" id="regra-operador-id" class="modal-input" placeholder="Digite a matrícula"/>
                    </div>

                    <label>Condições <small>(todas precisam ser verdadeiras)</small></label>
                    <div id="condicoes-lista"></div>
                    <button class="btn-add-condicao" onclick="adicionarCondicao()">+ Adicionar condição</button>

                </div>
                <div class="modal-footer">
                    <button class="btn-cancelar" onclick="fecharModalRegra()">Cancelar</button>
                    <button class="btn-confirmar" onclick="salvarRegra()">Salvar regra</button>
                </div>
            </div>
        </div>
    `;
}


async function carregarTudo() {
    try {
        const [resRegras, resPresets, resOps] = await Promise.all([
            fetchAuth('/regras'),
            fetchAuth('/regras/presets'),
            fetchAuth('/operadores/disponiveis')
        ]);
        regrasCarregadas    = await resRegras.json();
        presetsCarregados   = await resPresets.json();
        operadoresCarregados = await resOps.json();

        renderizarRegras();
        renderizarPresets();
    } catch (erro) {
        console.error('Erro ao carregar configurações:', erro);
    }
}


function renderizarRegras() {
    const lista = document.getElementById('regras-lista');

    if (regrasCarregadas.length === 0) {
        lista.innerHTML = '<div class="vazio">Nenhuma regra criada. Crie uma nova ou use um preset.</div>';
        return;
    }

    lista.innerHTML = '';
    regrasCarregadas.forEach(regra => {
        const card = document.createElement('div');
        card.className = `regra-card ${regra.ativo ? '' : 'regra-inativa'}`;
        card.innerHTML = `
            <div class="regra-card-info">
                <div class="regra-nome">${regra.nome}</div>
                <div class="regra-meta">
                    <span class="badge ${regra.modo === 'fixo' ? 'badge-reservada' : 'badge-pendente'}">
                        ${regra.modo === 'fixo' ? 'Fixo' : 'Automático'}
                    </span>
                    ${regra.operador_nome ? `<span>→ ${regra.operador_nome}</span>` : ''}
                    <span class="regra-prioridade">Prioridade: ${regra.prioridade}</span>
                </div>
                <div class="regra-condicoes">${formatarCondicoes(regra.condicoes)}</div>
            </div>
            <div class="regra-card-acoes">
                <label class="toggle">
                    <input type="checkbox" ${regra.ativo ? 'checked' : ''}
                        onchange="toggleRegra(${regra.id}, this.checked)">
                    <span class="toggle-slider"></span>
                </label>
                <button class="btn-deletar-regra" onclick="deletarRegra(${regra.id})">🗑</button>
            </div>
        `;
        lista.appendChild(card);
    });
}


function renderizarPresets() {
    const lista = document.getElementById('presets-lista');
    lista.innerHTML = '';

    presetsCarregados.forEach(preset => {
        const card = document.createElement('div');
        card.className = 'preset-card';
        card.innerHTML = `
            <div class="preset-info">
                <div class="preset-nome">${preset.nome}</div>
                <div class="preset-descricao">${preset.descricao || ''}</div>
                <div class="regra-condicoes">${formatarCondicoes(preset.condicoes)}</div>
            </div>
            <button class="btn-usar-preset" onclick="usarPreset(${preset.id})">
                Usar preset
            </button>
        `;
        lista.appendChild(card);
    });
}


function formatarCondicoes(condicoes) {
    if (!condicoes) return '';
    const lista = condicoes.all || condicoes.any || [];
    const tipo  = condicoes.all ? 'Todas:' : 'Qualquer:';
    return `<span class="condicao-tipo">${tipo}</span> ` +
        lista.map(c => `<span class="condicao-tag">${c.campo} ${c.op} ${c.valor}</span>`).join(' ');
}


function toggleOperadorFixo() {
    const modo  = document.getElementById('regra-modo').value;
    const campo = document.getElementById('campo-operador-fixo');
    campo.style.display = modo === 'fixo' ? 'block' : 'none';
}


function adicionarCondicao(campo = 'score', op = '<', valor = '') {
    const lista = document.getElementById('condicoes-lista');
    const idx   = lista.children.length;

    const row = document.createElement('div');
    row.className = 'condicao-row';
    row.innerHTML = `
        <select class="condicao-campo modal-input">
            <option value="score"   ${campo === 'score'   ? 'selected' : ''}>Score</option>
            <option value="tipo_os" ${campo === 'tipo_os' ? 'selected' : ''}>Tipo de OS</option>
        </select>
        <select class="condicao-op modal-input">
            <option value="<"  ${op === '<'  ? 'selected' : ''}>&lt;</option>
            <option value=">"  ${op === '>'  ? 'selected' : ''}>&gt;</option>
            <option value="<=" ${op === '<=' ? 'selected' : ''}>&lt;=</option>
            <option value=">=" ${op === '>=' ? 'selected' : ''}>&gt;=</option>
            <option value="="  ${op === '='  ? 'selected' : ''}>=</option>
            <option value="!=" ${op === '!=' ? 'selected' : ''}>≠</option>
        </select>
        <input type="text" class="condicao-valor modal-input" value="${valor}" placeholder="valor"/>
        <button class="btn-remover-condicao" onclick="this.parentElement.remove()">✕</button>
    `;
    lista.appendChild(row);
}


function coletarCondicoes() {
    const rows = document.querySelectorAll('.condicao-row');
    const all  = [];
    rows.forEach(row => {
        const campo = row.querySelector('.condicao-campo').value;
        const op    = row.querySelector('.condicao-op').value;
        const valor = row.querySelector('.condicao-valor').value.trim();
        if (campo && op && valor) {
            all.push({ campo, op, valor: isNaN(valor) ? valor : parseFloat(valor) });
        }
    });
    return { all };
}


async function salvarRegra() {
    const nome        = document.getElementById('regra-nome').value.trim();
    const modo        = document.getElementById('regra-modo').value;
    const prioridade  = parseInt(document.getElementById('regra-prioridade').value) || 0;
    const operador_id = modo === 'fixo'
        ? parseInt(document.getElementById('regra-operador-id').value) || null
        : null;
    const condicoes   = coletarCondicoes();

    if (!nome) {
        mostrarNotificacao('Digite um nome para a regra.', 'aviso');
        return;
    }
    if (condicoes.all.length === 0) {
        mostrarNotificacao('Adicione pelo menos uma condição.', 'aviso');
        return;
    }

    try {
        const resposta = await fetchAuth('/regras', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, modo, prioridade, operador_id, condicoes })
        });
        const resultado = await resposta.json();

        if (resultado.sucesso) {
            fecharModalRegra();
            mostrarNotificacao('Regra criada com sucesso.', 'sucesso');
            carregarTudo();
        }
    } catch (erro) {
        mostrarNotificacao('Erro ao salvar regra.', 'erro');
    }
}


function usarPreset(presetId) {
    const preset = presetsCarregados.find(p => p.id === presetId);
    if (!preset) return;

    abrirModalNovaRegra();

    document.getElementById('regra-nome').value = preset.nome;
    document.getElementById('regra-modo').value = preset.modo;
    toggleOperadorFixo();

    const lista = document.getElementById('condicoes-lista');
    lista.innerHTML = '';
    const condicoes = preset.condicoes.all || preset.condicoes.any || [];
    condicoes.forEach(c => adicionarCondicao(c.campo, c.op, c.valor));
}


function abrirModalNovaRegra() {
    document.getElementById('modal-nova-regra').style.display = 'flex';
    document.getElementById('condicoes-lista').innerHTML = '';
    adicionarCondicao();
}


function fecharModalRegra() {
    document.getElementById('modal-nova-regra').style.display = 'none';
}


async function toggleRegra(regraId, ativo) {
    try {
        await fetchAuth(`/regras/${regraId}/ativo?ativo=${ativo}`, { method: 'PATCH' });
        mostrarNotificacao(`Regra ${ativo ? 'ativada' : 'desativada'}.`, 'sucesso');
        carregarTudo();
    } catch (erro) {
        mostrarNotificacao('Erro ao atualizar regra.', 'erro');
    }
}


async function deletarRegra(regraId) {
    if (!confirm('Deletar esta regra permanentemente?')) return;
    try {
        await fetchAuth(`/regras/${regraId}`, { method: 'DELETE' });
        mostrarNotificacao('Regra deletada.', 'sucesso');
        carregarTudo();
    } catch (erro) {
        mostrarNotificacao('Erro ao deletar regra.', 'erro');
    }
}