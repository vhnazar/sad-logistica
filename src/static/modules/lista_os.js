// modules/lista_os.js
// Responsável por carregar e renderizar a lista de OS pendentes e em andamento

// Variável que guarda as OS carregadas - evita buscar de novo desnecessariamente
let osCarregadas = [];

// Função chamada pelo app.js quando o usuário navega para essa aba
function inicializarListaOS() {
    renderizarEstrutura();
    carregarOS();
}


// ESTRUTURA HTML da aba - criada uma vez via JavaScript
function renderizarEstrutura() {
    const pagina = document.getElementById('pagina-lista-os');

    // Só renderiza a estrutura se ainda não foi criada
    if (pagina.querySelector('.lista-os-container')) return;

    pagina.innerHTML = `
        <div class="lista-os-container">

            <div class="lista-os-header">
                <h1>Gerenciador de OS</h1>
                <button class="btn-atualizar" onclick="carregarOS()">
                    Atualizar
                </button>
            </div>

            <!-- Filtros rápidos -->
            <div class="filtros-rapidos">
                <button class="filtro-btn ativo" data-filtro="todos">
                    Todas
                </button>
                <button class="filtro-btn" data-filtro="pendente">
                    Pendentes
                </button>
                <button class="filtro-btn" data-filtro="em_andamento">
                    Em Andamento
                </button>
                <button class="filtro-btn" data-filtro="reservada">
                    Reservadas
                </button>
            </div>

            <!-- Contador -->
            <div id="os-contador" class="os-contador"></div>

            <!-- Grid de cards -->
            <div id="os-grid" class="os-grid">
                <div class="carregando">Carregando OS...</div>
            </div>

        </div>
    `;

    // Adiciona eventos nos filtros
    pagina.querySelectorAll('.filtro-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            pagina.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('ativo'));
            btn.classList.add('ativo');
            filtrarOS(btn.getAttribute('data-filtro'));
        });
    });
}

// BUSCA OS DA API
async function carregarOS() {
    const grid = document.getElementById('os-grid');
    grid.innerHTML = '<div class="carregando">Carregando OS...</div>';

    try {
        // Busca OS pendentes com sugestões
        const respostaPendentes = await fetch('/os/pendentes');
        const osPendentes = await respostaPendentes.json();

        // Busca OS reservadas
        const respostaReservadas = await fetch('/os/reservadas');
        const osReservadas = await respostaReservadas.json();

        // Marca quais OS estão reservadas
        const idsReservados = new Set(osReservadas.map(r => r.os_id));
        osCarregadas = osPendentes.map(os => ({
            ...os,
            reservada: idsReservados.has(os.os_id),
            reserva: osReservadas.find(r => r.os_id === os.os_id) || null
        }));

        renderizarCards(osCarregadas);

    } catch (erro) {
        // Feedback claro para o usuário em caso de falha
        grid.innerHTML = `
            <div class="erro">
                Erro ao carregar OS. Verifique a conexão com o servidor.
                <br><small>${erro.message}</small>
            </div>
        `;
        console.error('Erro ao carregar OS:', erro);
    }
}

// RENDERIZA OS CARDS NA TELA
function renderizarCards(listaOS) {
    const grid = document.getElementById('os-grid');
    const contador = document.getElementById('os-contador');

    if (listaOS.length === 0) {
        grid.innerHTML = '<div class="vazio">Nenhuma OS encontrada.</div>';
        contador.textContent = '';
        return;
    }

    contador.textContent = `${listaOS.length} OS encontrada${listaOS.length > 1 ? 's' : ''}`;

    grid.innerHTML = '';

    listaOS.forEach(os => {
        const card = document.createElement('div');
        card.className = `os-card ${os.reservada ? 'os-reservada' : 'os-pendente'}`;
        card.setAttribute('data-os-id', os.os_id);

        card.innerHTML = `
            <div class="os-card-header">
                <span class="os-id">OS #${os.os_id}</span>
                ${os.reservada
                    ? `<span class="badge badge-reservada">
                           Reservada · ${os.reserva.operador_nome}
                       </span>`
                    : `<span class="badge badge-pendente">Pendente</span>`
                }
            </div>

            <div class="os-card-body">
                <div class="os-tipo">${os.tipo_os}</div>
                <div class="os-info">
                    <span title="Operador sugerido"> ${os.operador_nome}</span>
                    <span title="Score estimado"> ${formatarTempo(os.score)}</span>
                </div>
                <div class="os-alternativa">
                    Alternativa: ${os.alternativa}
                </div>
            </div>

            <div class="os-card-footer">
                <button class="btn-detalhes" onclick="abrirDetalhesOS(${os.os_id})">
                    Ver detalhes
                </button>
                ${os.reservada
                    ? `<button class="btn-cancelar-reserva" onclick="cancelarReserva(${os.os_id})">
                           Cancelar reserva
                       </button>`
                    : `<button class="btn-reservar" onclick="abrirModalReserva(${os.os_id})">
                           Reservar
                       </button>`
                }
            </div>
        `;

        grid.appendChild(card);
    });
}


// FILTRO
function filtrarOS(filtro) {
    if (filtro === 'todos') {
        renderizarCards(osCarregadas);
        return;
    }

    if (filtro === 'reservada') {
        renderizarCards(osCarregadas.filter(os => os.reservada));
        return;
    }

    renderizarCards(osCarregadas.filter(os => !os.reservada));
}


// FORMATA SEGUNDOS
function formatarTempo(segundos) {
    const s = Math.round(segundos);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const seg = s % 60;

    if (h > 0) return `${h}h ${m}m ${seg}s`;
    if (m > 0) return `${m}m ${seg}s`;
    return `${seg}s`;
}


// CANCELAR RESERVA
async function cancelarReserva(osId) {
    const confirmar = confirm(`Cancelar reserva da OS #${osId}?`);
    if (!confirmar) return;

    try {
        const resposta = await fetch(`/reservar/${osId}`, {
            method: 'DELETE'
        });
        const resultado = await resposta.json();

        if (resultado.sucesso) {
            mostrarNotificacao('Reserva cancelada com sucesso.', 'sucesso');
            carregarOS(); // Recarrega os cards
        } else {
            mostrarNotificacao('Erro ao cancelar reserva.', 'erro');
        }

    } catch (erro) {
        mostrarNotificacao('Erro de conexão.', 'erro');
        console.error('Erro ao cancelar reserva:', erro);
    }
}


// MODAL DE RESERVA
function abrirModalReserva(osId) {
    const os = osCarregadas.find(o => o.os_id === osId);
    if (!os) return;

    // Remove modal anterior se existir
    document.getElementById('modal-reserva')?.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-reserva';
    modal.className = 'modal-overlay';

    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>Reservar OS #${os.os_id}</h3>
                <button class="modal-fechar" onclick="document.getElementById('modal-reserva').remove()">✕</button>
            </div>

            <div class="modal-body">
                <p class="modal-tipo">${os.tipo_os}</p>

                <label for="input-matricula">Matrícula do operador</label>
                <input
                    type="number"
                    id="input-matricula"
                    class="modal-input"
                    placeholder="Digite a matrícula"
                    min="1"
                />

                <p class="modal-sugestao">
                    Sugestão: <strong>${os.operador_nome}</strong>
                    (matrícula ${os.operador_id})
                    · Score: ${formatarTempo(os.score)}
                </p>

                <button
                    class="btn-usar-sugestao"
                    onclick="document.getElementById('input-matricula').value = ${os.operador_id}">
                    Usar sugestão
                </button>
            </div>

            <div class="modal-footer">
                <button class="btn-cancelar" onclick="document.getElementById('modal-reserva').remove()">
                    Cancelar
                </button>
                <button class="btn-confirmar" onclick="confirmarReserva(${os.os_id})">
                    Confirmar reserva
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Fecha ao clicar fora do modal
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    // Foca no input automaticamente
    setTimeout(() => document.getElementById('input-matricula').focus(), 50);
}


// CONFIRMAR RESERVA
async function confirmarReserva(osId) {
    const matricula = parseInt(document.getElementById('input-matricula').value);

    if (!matricula || matricula < 1) {
        mostrarNotificacao('Digite uma matrícula válida.', 'aviso');
        return;
    }

    try {
        const resposta = await fetch('/os/reservar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                os_id: osId,
                operador_id: matricula,
                reservado_por: 'gestor'
            })
        });
        const resultado = await resposta.json();

        if (resultado.sucesso) {
            document.getElementById('modal-reserva').remove();
            mostrarNotificacao(`OS #${osId} reservada com sucesso.`, 'sucesso');
            carregarOS();
        } else {
            mostrarNotificacao(resultado.motivo || 'Erro ao reservar OS.', 'erro');
        }

    } catch (erro) {
        mostrarNotificacao('Erro de conexão.', 'erro');
        console.error('Erro ao reservar OS:', erro);
    }
}


// DETALHES DA OS
function abrirDetalhesOS(osId) {
    const os = osCarregadas.find(o => o.os_id === osId);
    if (!os) return;

    document.getElementById('modal-detalhes')?.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-detalhes';
    modal.className = 'modal-overlay';

    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>OS #${os.os_id} — Detalhes</h3>
                <button class="modal-fechar" onclick="document.getElementById('modal-detalhes').remove()">✕</button>
            </div>

            <div class="modal-body">
                <table class="modal-tabela">
                    <tr><td>Tipo</td><td>${os.tipo_os}</td></tr>
                    <tr><td>Operador sugerido</td><td>${os.operador_nome} (${os.operador_id})</td></tr>
                    <tr><td>Alternativa</td><td>${os.alternativa}</td></tr>
                    <tr><td>Tempo base</td><td>${formatarTempo(os.tempo_base_seg)}</td></tr>
                    <tr><td>Custo distância</td><td>${formatarTempo(os.custo_distancia)}</td></tr>
                    <tr><td>Score total</td><td><strong>${formatarTempo(os.score)}</strong></td></tr>
                    ${os.reservada
                        ? `<tr><td>Reservada para</td><td>${os.reserva.operador_nome}</td></tr>`
                        : ''
                    }
                </table>
            </div>

            <div class="modal-footer">
                <button class="btn-os-itens" onclick="abrirDetalhesItens(${os.os_id})">
                    Ver detalhes dos itens
                </button>
                <button class="btn-cancelar" onclick="document.getElementById('modal-detalhes').remove()">
                    Fechar
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}


// DETALHES DOS ITENS DA OS
async function abrirDetalhesItens(osId) {
    // Remove modal anterior se existir
    document.getElementById('modal-itens')?.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-itens';
    modal.className = 'modal-overlay';

    modal.innerHTML = `
        <div class="modal modal-itens">
            <div class="modal-header">
                <h3>Itens da OS #${osId}</h3>
                <button class="modal-fechar" onclick="document.getElementById('modal-itens').remove()">✕</button>
            </div>
            <div class="modal-body">
                <div class="carregando">Carregando itens...</div>
            </div>
            <div class="modal-footer">
                <button class="btn-cancelar" onclick="document.getElementById('modal-itens').remove()">
                    Fechar
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    try {
        const resposta = await fetch(`/os/${osId}/itens`);
        const itens = await resposta.json();

        const modalBody = modal.querySelector('.modal-body');

        if (itens.length === 0) {
            modalBody.innerHTML = '<div class="vazio">Nenhum item encontrado para esta OS.</div>';
            return;
        }

        // Tabela de itens com scroll
        let html = `
            <div class="modal-tabela-scroll">
                <table class="modal-tabela">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Produto</th>
                            <th>Endereço</th>
                            <th>Qtde</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        itens.forEach(item => {
            const status = getStatusItem(item);
            html += `
                <tr>
                    <td>${item.codigo_produto || '-'}</td>
                    <td>${item.produto || '-'}</td>
                    <td>Rua: ${item.rua} | Prédio: ${item.predio} | Nível: ${item.nivel} | Apto: ${item.apartamento}</td>
                    <td>${item.qt_finalizada || 0}/${item.qt_total}</td>
                    <td>${status}</td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        modalBody.innerHTML = html;

    } catch (erro) {
        modal.querySelector('.modal-body').innerHTML = `
            <div class="erro">Erro ao carregar itens: ${erro.message}</div>
        `;
        console.error('Erro ao carregar itens:', erro);
    }

    // Fecha ao clicar fora do modal
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}


// STATUS DO ITEM
function getStatusItem(item) {
    if (item.dt_finalizacao) return '<span class="badge badge-sucesso">Finalizado</span>';
    if (item.dt_corte) return '<span class="badge badge-erro">Cortado</span>';
    if (item.dt_cancelamento) return '<span class="badge badge-cancelado">Cancelado</span>';
    return '<span class="badge badge-pendente">Pendente</span>';
}


// NOTIFICAÇÃO
function mostrarNotificacao(mensagem, tipo = 'sucesso') {
    document.getElementById('notificacao')?.remove();

    const notif = document.createElement('div');
    notif.id = 'notificacao';
    notif.className = `notificacao notificacao-${tipo}`;
    notif.textContent = mensagem;

    document.body.appendChild(notif);

    // Some automaticamente após 3 segundos
    setTimeout(() => notif.remove(), 3000);
}