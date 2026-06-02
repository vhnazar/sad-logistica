// Painel de atribuição de OS - drag and drop e atribuição manual

let osPainel = [];
let operadoresPainel = [];
let osSelecionada = null;

function inicializarAtribuicao() {
    renderizarEstruturaAtribuicao();
    carregarPainel();
}

function renderizarEstruturaAtribuicao() {
    const pagina = document.getElementById('pagina-atribuicao');
    if (pagina.querySelector('.atribuicao-container')) return;

    pagina.innerHTML = `
        <div class="atribuicao-container">

            <div class="atribuicao-header">
                <h1>Painel de Atribuição</h1>
                <button class="btn-atualizar" onclick="carregarPainel()">Atualizar</button>
            </div>

            <div class="atribuicao-layout">

                <!-- Coluna OS -->
                <div class="atribuicao-coluna">
                    <div class="atribuicao-coluna-header">
                        <h2>OS Pendentes</h2>
                        <span id="os-painel-contador" class="os-contador"></span>
                    </div>
                    <div id="os-painel" class="os-painel">
                        <div class="carregando">Carregando OS...</div>
                    </div>
                </div>

                <!-- Seta central -->
                <div class="atribuicao-seta">→</div>

                <!-- Coluna Operadores -->
                <div class="atribuicao-coluna atribuicao-coluna-operadores">
                    <div class="atribuicao-coluna-header">
                        <h2>Operadores</h2>
                        <div class="operador-filtros">
                            <button class="filtro-btn ativo" data-filtro="todos">Todos</button>
                            <button class="filtro-btn" data-filtro="disponivel">Disponíveis</button>
                        </div>
                    </div>
                    <div id="operadores-painel" class="operadores-painel">
                        <div class="carregando">Carregando operadores...</div>
                    </div>
                </div>

            </div>

        </div>

        <!-- Modal de confirmação -->
        <div id="modal-confirmar-atribuicao" class="modal-overlay" style="display:none">
            <div class="modal">
                <div class="modal-header">
                    <h3>Confirmar Atribuição</h3>
                    <button class="modal-fechar" onclick="fecharModalAtribuicao()">✕</button>
                </div>
                <div class="modal-body" id="modal-atribuicao-body"></div>
                <div class="modal-footer">
                    <button class="btn-cancelar" onclick="fecharModalAtribuicao()">Cancelar</button>
                    <button class="btn-confirmar" id="btn-confirmar-atribuicao">Confirmar</button>
                </div>
            </div>
        </div>
    `;

    // Filtros de operadores
    pagina.querySelectorAll('.operador-filtros .filtro-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            pagina.querySelectorAll('.operador-filtros .filtro-btn').forEach(b => b.classList.remove('ativo'));
            btn.classList.add('ativo');
            renderizarOperadoresPainel(btn.getAttribute('data-filtro'));
        });
    });
}


async function carregarPainel() {
    try {
        const [resOS, resOps] = await Promise.all([
            fetchAuth('/os/pendentes'),
            fetchAuth('/operadores/status')
        ]);
        osPainel         = await resOS.json();
        operadoresPainel = await resOps.json();

        renderizarOSPainel();
        renderizarOperadoresPainel('todos');

    } catch (erro) {
        console.error('Erro ao carregar painel:', erro);
    }
}


function renderizarOSPainel() {
    const painel   = document.getElementById('os-painel');
    const contador = document.getElementById('os-painel-contador');

    contador.textContent = `${osPainel.length} OS`;

    if (osPainel.length === 0) {
        painel.innerHTML = '<div class="vazio">Nenhuma OS pendente.</div>';
        return;
    }

    painel.innerHTML = '';
    osPainel.forEach(os => {
        const card = document.createElement('div');
        card.className = `os-painel-card ${osSelecionada?.os_id === os.os_id ? 'os-selecionada' : ''}`;
        card.setAttribute('draggable', 'true');
        card.setAttribute('data-os-id', os.os_id);

        // Badge de regra aplicada
        const badgeRegra = os.regra_aplicada
            ? `<span class="badge badge-regra" title="Regra: ${os.regra_aplicada}">Auto</span>`
            : '';

        card.innerHTML = `
            <div class="os-painel-card-topo">
                <span class="os-id">OS #${os.os_id}</span>
                ${badgeRegra}
            </div>
            <div class="os-painel-tipo">${os.tipo_os}</div>
            <div class="os-painel-sugestao">
                <span>${os.operador_nome}</span>
                <span>${formatarTempoAtribuicao(os.score)}</span>
            </div>
            <div class="os-painel-acoes">
                <button class="btn-atribuir-sugerido"
                    onclick="confirmarAtribuicao(${os.os_id}, ${os.operador_id}, '${os.operador_nome}', false)">
                    Atribuir sugerido
                </button>
                <button class="btn-atribuir-alternativa"
                    onclick="abrirSeletorOperador(${os.os_id})">
                    Escolher operador
                </button>
            </div>
        `;

        // Drag events
        card.addEventListener('dragstart', (e) => {
            osSelecionada = os;
            card.classList.add('os-arrastando');
            e.dataTransfer.effectAllowed = 'move';
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('os-arrastando');
        });

        card.addEventListener('click', () => {
            osSelecionada = os;
            document.querySelectorAll('.os-painel-card').forEach(c => c.classList.remove('os-selecionada'));
            card.classList.add('os-selecionada');
        });

        painel.appendChild(card);
    });
}


function renderizarOperadoresPainel(filtro = 'todos') {
    const painel = document.getElementById('operadores-painel');

    const lista = filtro === 'disponivel'
        ? operadoresPainel.filter(op => op.status_operador === 'disponivel')
        : operadoresPainel;

    if (lista.length === 0) {
        painel.innerHTML = '<div class="vazio">Nenhum operador encontrado.</div>';
        return;
    }

    painel.innerHTML = '';
    lista.forEach(op => {
        const card = document.createElement('div');
        card.className = `operador-card operador-${op.status_operador}`;
        card.setAttribute('data-operador-id', op.operador_id);

        const statusLabel = {
            disponivel:   '● Disponível',
            em_andamento: '● Em andamento',
            deslogado:    '● Deslogado'
        }[op.status_operador] || '';

        card.innerHTML = `
            <div class="operador-card-nome">${op.nome}</div>
            <div class="operador-card-status">${statusLabel}</div>
            ${op.os_ativa ? `<div class="operador-card-os">OS #${op.os_ativa}</div>` : ''}
        `;

        // Drop target
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (op.status_operador === 'disponivel') {
                card.classList.add('operador-drop-hover');
            }
        });

        card.addEventListener('dragleave', () => {
            card.classList.remove('operador-drop-hover');
        });

        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('operador-drop-hover');
            if (osSelecionada && op.status_operador === 'disponivel') {
                confirmarAtribuicao(osSelecionada.os_id, op.operador_id, op.nome, true);
            }
        });

        // Click para atribuir OS selecionada
        card.addEventListener('click', () => {
            if (osSelecionada && op.status_operador === 'disponivel') {
                confirmarAtribuicao(osSelecionada.os_id, op.operador_id, op.nome, true);
            }
        });

        painel.appendChild(card);
    });
}


function confirmarAtribuicao(osId, operadorId, operadorNome, manual) {
    const os = osPainel.find(o => o.os_id === osId);
    if (!os) return;

    const body = document.getElementById('modal-atribuicao-body');
    body.innerHTML = `
        <table class="modal-tabela">
            <tr><td>OS</td><td><strong>#${osId}</strong> — ${os.tipo_os}</td></tr>
            <tr><td>Operador</td><td><strong>${operadorNome}</strong></td></tr>
            <tr><td>Tipo</td><td>${manual ? 'Atribuição manual' : 'Atribuição sugerida'}</td></tr>
            ${os.regra_aplicada ? `<tr><td>Regra</td><td>${os.regra_aplicada}</td></tr>` : ''}
            <tr><td>Score estimado</td><td>${formatarTempoAtribuicao(os.score)}</td></tr>
        </table>
        <p class="modal-aviso">Esta ação não pode ser desfeita.</p>
    `;

    const btn = document.getElementById('btn-confirmar-atribuicao');
    btn.onclick = () => executarAtribuicao(osId, operadorId);

    document.getElementById('modal-confirmar-atribuicao').style.display = 'flex';
}


async function executarAtribuicao(osId, operadorId) {
    try {
        const resposta = await fetchAuth('/atribuir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ os_id: osId, operador_id: operadorId })
        });
        const resultado = await resposta.json();

        fecharModalAtribuicao();

        if (resultado.sucesso) {
            mostrarNotificacao(`OS #${osId} atribuída com sucesso.`, 'sucesso');
            osSelecionada = null;
            carregarPainel();
        } else {
            mostrarNotificacao('Erro ao atribuir OS.', 'erro');
        }
    } catch (erro) {
        mostrarNotificacao('Erro de conexão.', 'erro');
        console.error('Erro ao atribuir:', erro);
    }
}


function abrirSeletorOperador(osId) {
    osSelecionada = osPainel.find(o => o.os_id === osId);
    mostrarNotificacao('Selecione um operador disponível no painel ao lado.', 'aviso');
    document.querySelectorAll('.os-painel-card').forEach(c => c.classList.remove('os-selecionada'));
    const card = document.querySelector(`[data-os-id="${osId}"]`);
    if (card) card.classList.add('os-selecionada');
}


function fecharModalAtribuicao() {
    document.getElementById('modal-confirmar-atribuicao').style.display = 'none';
}


function formatarTempoAtribuicao(segundos) {
    const s = Math.round(segundos);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const seg = s % 60;
    if (h > 0) return `${h}h ${m}m ${seg}s`;
    if (m > 0) return `${m}m ${seg}s`;
    return `${seg}s`;
}