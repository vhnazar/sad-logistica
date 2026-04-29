// Heatmap de congestionamento do armazém — grade unificada com filtros por tipo

let dadosMapa = [];
let dimensoes = [];
let filtroTipo = 'todos'; // 'todos' | 'solo' | 'elevado'

function inicializarMapa() {
    renderizarEstruturaMapa();
    carregarMapa();
}

function renderizarEstruturaMapa() {
    const pagina = document.getElementById('pagina-mapa');
    if (pagina.querySelector('.mapa-container')) return;

    pagina.innerHTML = `
        <div class="mapa-container">

            <div class="mapa-header">
                <h1>Mapa de Congestionamento</h1>
                <div class="mapa-controles">
                    <div class="deposito-tabs">
                        <button class="deposito-tab ativo" data-tipo="todos">Todos</button>
                        <button class="deposito-tab" data-tipo="solo">Solo</button>
                        <button class="deposito-tab" data-tipo="elevado">Elevado</button>
                    </div>
                    <button class="btn-atualizar" onclick="carregarMapa()">↻ Atualizar</button>
                </div>
            </div>

            <div class="mapa-legenda">
                <span class="legenda-titulo">Densidade:</span>
                <div class="legenda-item">
                    <div class="legenda-cor" style="background:#e8f5e9"></div>
                    <span>Vazio</span>
                </div>
                <div class="legenda-item">
                    <div class="legenda-cor" style="background:#fff176"></div>
                    <span>1 operador</span>
                </div>
                <div class="legenda-item">
                    <div class="legenda-cor" style="background:#ffb74d"></div>
                    <span>2 operadores</span>
                </div>
                <div class="legenda-item">
                    <div class="legenda-cor" style="background:#ef5350"></div>
                    <span>3+ operadores</span>
                </div>
                <div class="legenda-item">
                    <div class="legenda-cor legenda-inexistente"></div>
                    <span>Não existe</span>
                </div>
            </div>

            <div class="mapa-scroll">
                <div id="mapa-grade" class="mapa-grade">
                    <div class="carregando">Carregando mapa...</div>
                </div>
            </div>

            <div id="mapa-alerta" class="mapa-alerta" style="display:none"></div>

        </div>

        <div id="mapa-tooltip" class="mapa-tooltip" style="display:none"></div>
    `;

    pagina.querySelectorAll('.deposito-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            pagina.querySelectorAll('.deposito-tab').forEach(t => t.classList.remove('ativo'));
            tab.classList.add('ativo');
            filtroTipo = tab.getAttribute('data-tipo');
            renderizarGrade();
        });
    });
}


async function carregarMapa() {
    const grade = document.getElementById('mapa-grade');
    grade.innerHTML = '<div class="carregando">Carregando mapa...</div>';

    try {
        const [resCong, resDim] = await Promise.all([
            fetch('/mapa/congestionamento'),
            fetch('/mapa/dimensoes')
        ]);
        dadosMapa = await resCong.json();
        dimensoes = await resDim.json();
        renderizarGrade();
    } catch (erro) {
        grade.innerHTML = `<div class="erro">Erro ao carregar mapa: ${erro.message}</div>`;
        console.error('Erro ao carregar mapa:', erro);
    }
}


function renderizarGrade() {
    const grade  = document.getElementById('mapa-grade');
    const alerta = document.getElementById('mapa-alerta');

    // Dimensões baseadas nos depósitos do filtro atual
    const depsFiltrados = filtroTipo === 'todos'   ? dimensoes
                        : filtroTipo === 'solo'    ? dimensoes.filter(d => d.deposito_id === 1)
                        : dimensoes.filter(d => d.deposito_id === 2);

    const maxRua    = Math.max(...depsFiltrados.map(d => Math.max(...d.ruas)));
    const maxPredio = Math.max(...depsFiltrados.map(d => Math.max(...d.predios)));

    // Conjunto de células válidas - só dos depósitos filtrados
    const celulasValidas = {};
    depsFiltrados.forEach(d => {
        celulasValidas[d.deposito_id] = new Set(
            d.ruas.flatMap(r => d.predios.map(p => `${r}-${p}`))
        );
    });

    // deps para verificar existência de célula
    const deps = depsFiltrados.map(d => d.deposito_id);

    // Filtra dados por tipo
    const dadosFiltrados = dadosMapa.filter(z => {
        if (filtroTipo === 'todos')   return true;
        if (filtroTipo === 'solo')    return z.deposito_id === 1;
        if (filtroTipo === 'elevado') return z.deposito_id === 2;
    });

    // Indexa por rua+predio - agrega operadores de ambos os depósitos se filtro = todos
    const mapaIndex = {};
    dadosFiltrados.forEach(z => {
        const chave = `${z.rua}-${z.predio}`;
        if (!mapaIndex[chave]) {
            mapaIndex[chave] = { total: 0, operadores: [] };
        }
        mapaIndex[chave].total += z.total_operadores;
        mapaIndex[chave].operadores.push(...z.operadores);
    });

    // Zona mais crítica
    let zonaCritica = null;
    Object.entries(mapaIndex).forEach(([chave, zona]) => {
        if (!zonaCritica || zona.total > zonaCritica.total) {
            const [rua, predio] = chave.split('-');
            zonaCritica = { rua, predio, total: zona.total };
        }
    });

    if (zonaCritica && zonaCritica.total >= 2) {
        alerta.style.display = 'flex';
        alerta.innerHTML = `Zona crítica: <strong>Rua ${zonaCritica.rua} · Prédio ${zonaCritica.predio}</strong> — ${zonaCritica.total} operadores`;
    } else {
        alerta.style.display = 'none';
    }

    // Célula existe se existir em pelo menos um dos depósitos filtrados
    const celulaExiste = (rua, predio) =>
        deps.some(d => celulasValidas[d]?.has(`${rua}-${predio}`));

    // Monta grade
    const ruas    = Array.from({length: maxRua},    (_, i) => i + 1);
    const predios = Array.from({length: maxPredio}, (_, i) => i + 1);

    let html = '<table class="mapa-tabela"><thead><tr><th>Rua \\ Prédio</th>';
    predios.forEach(p => { html += `<th>P${p}</th>`; });
    html += '</tr></thead><tbody>';

    ruas.forEach(rua => {
        html += `<tr><td class="mapa-label-rua">Rua ${rua}</td>`;
        predios.forEach(predio => {
            if (!celulaExiste(rua, predio)) {
                html += `<td class="mapa-celula mapa-inexistente" title="Posição inexistente"></td>`;
                return;
            }

            const zona  = mapaIndex[`${rua}-${predio}`];
            const total = zona ? zona.total : 0;
            const cor   = getCor(total);
            const pulse = total >= 3 ? 'mapa-pulse' : '';
            const ops   = zona ? zona.operadores : [];

            html += `
                <td class="mapa-celula ${pulse}"
                    style="background:${cor}"
                    data-rua="${rua}"
                    data-predio="${predio}"
                    data-total="${total}"
                    data-operadores='${JSON.stringify(ops).replace(/'/g, "&#39;")}'>
                    ${total > 0 ? `<span class="mapa-count">${total}</span>` : ''}
                </td>
            `;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    grade.innerHTML = html;

    grade.querySelectorAll('.mapa-celula:not(.mapa-inexistente)').forEach(cel => {
        cel.addEventListener('mouseenter', mostrarTooltipMapa);
        cel.addEventListener('mouseleave', esconderTooltipMapa);
        cel.addEventListener('mousemove',  moverTooltipMapa);
    });
}


function getCor(total) {
    if (total === 0) return '#e8f5e9';
    if (total === 1) return '#fff176';
    if (total === 2) return '#ffb74d';
    return '#ef5350';
}


function mostrarTooltipMapa(e) {
    const cel     = e.currentTarget;
    const total   = parseInt(cel.getAttribute('data-total'));
    const rua     = cel.getAttribute('data-rua');
    const predio  = cel.getAttribute('data-predio');
    const ops     = JSON.parse(cel.getAttribute('data-operadores'));
    const tooltip = document.getElementById('mapa-tooltip');

    if (total === 0) {
        tooltip.style.display = 'none';
        return;
    }

    let html = `<strong>Rua ${rua} - Prédio ${predio}</strong><br>`;
    html += `${total} operador${total > 1 ? 'es' : ''}<hr>`;
    ops.forEach(op => {
        const tipo = op.deposito_id === 1 ? 'SOLO' : 'ELEVADO';
        html += `${op.nome} ${tipo}<br>`;
        html += `OS #${op.os_id} - ${op.tempo_execucao}<br><br>`;
    });

    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
}

function esconderTooltipMapa() {
    document.getElementById('mapa-tooltip').style.display = 'none';
}

function moverTooltipMapa(e) {
    const tooltip = document.getElementById('mapa-tooltip');
    tooltip.style.left = (e.pageX + 12) + 'px';
    tooltip.style.top  = (e.pageY + 12) + 'px';
}