// Painel de Indicadores Operacionais

let dadosDashboard = {
    resumo: null,
    produtividade: [],
    volume: [],
    congestionamento: [],
    tiposOS: []
};

let filtrosDashboard = {
    dias: 90,
    deposito_id: null,
    tipo_os: null
};

function inicializarDashboard() {
    renderizarEstruturaDashboard();
    carregarDashboard();
}

function renderizarEstruturaDashboard() {
    const pagina = document.getElementById('pagina-dashboard');
    if (pagina.querySelector('.dashboard-container')) return;

    pagina.innerHTML = `
        <div class="dashboard-container">

            <div class="dashboard-header">
                <h1>Painel de Indicadores</h1>
                <button class="btn-atualizar" onclick="carregarDashboard()">Atualizar</button>
            </div>

            <!-- Filtros globais -->
            <div class="dashboard-filtros">
                <div class="filtro-grupo">
                    <label>Período</label>
                    <select id="filtro-dias" class="filtro-select" onchange="aplicarFiltros()">
                        <option value="7">Últimos 7 dias</option>
                        <option value="30">Últimos 30 dias</option>
                        <option value="90" selected>Últimos 90 dias</option>
                        <option value="365">Último ano</option>
                    </select>
                </div>
                <div class="filtro-grupo">
                    <label>Depósito</label>
                    <select id="filtro-deposito" class="filtro-select" onchange="aplicarFiltros()">
                        <option value="">Todos</option>
                        <option value="1">Solo</option>
                        <option value="2">Elevado</option>
                    </select>
                </div>
                <div class="filtro-grupo">
                    <label>Tipo de OS</label>
                    <select id="filtro-tipo-os" class="filtro-select" onchange="aplicarFiltros()">
                        <option value="">Todos</option>
                    </select>
                </div>
            </div>

            <!-- Cards de resumo -->
            <div class="dashboard-cards" id="dashboard-cards">
                <div class="carregando">Carregando...</div>
            </div>

            <!-- Gráficos -->
            <div class="dashboard-graficos">

                <div class="grafico-secao">
                    <h2>Volume de OS por Tipo</h2>
                    <canvas id="grafico-volume"></canvas>
                </div>

                <div class="grafico-secao">
                    <h2>Produtividade por Operador</h2>
                    <div class="filtro-grupo" style="margin-bottom:12px">
                        <select id="filtro-prod-tipo" class="filtro-select" onchange="renderizarGraficoProdutividade()">
                            <option value="">Todos os tipos</option>
                        </select>
                    </div>
                    <canvas id="grafico-produtividade"></canvas>
                </div>

                <div class="grafico-secao grafico-full">
                    <h2>Heatmap de Atividade - Hora x Dia da Semana</h2>
                    <div id="grafico-heatmap"></div>
                </div>

            </div>

        </div>
    `;
}

async function carregarDashboard() {
    try {
        const [resResumo, resProd, resVol, resCong, resTipos] = await Promise.all([
            fetch(`/dashboard/resumo?dias=${filtrosDashboard.dias}${filtrosDashboard.deposito_id ? '&deposito_id='+filtrosDashboard.deposito_id : ''}${filtrosDashboard.tipo_os ? '&tipo_os='+filtrosDashboard.tipo_os : ''}`),
            fetch(`/dashboard/produtividade?dias=${filtrosDashboard.dias}${filtrosDashboard.deposito_id ? '&deposito_id='+filtrosDashboard.deposito_id : ''}${filtrosDashboard.tipo_os ? '&tipo_os='+filtrosDashboard.tipo_os : ''}`),
            fetch(`/dashboard/volume?dias=${filtrosDashboard.dias}${filtrosDashboard.deposito_id ? '&deposito_id='+filtrosDashboard.deposito_id : ''}${filtrosDashboard.tipo_os ? '&tipo_os='+filtrosDashboard.tipo_os : ''}`),
            fetch(`/dashboard/congestionamento?dias=${filtrosDashboard.dias}${filtrosDashboard.deposito_id ? '&deposito_id='+filtrosDashboard.deposito_id : ''}`),
            fetch('/dashboard/tipos_os')
        ]);

        dadosDashboard.resumo           = await resResumo.json();
        dadosDashboard.produtividade    = await resProd.json();
        dadosDashboard.volume           = await resVol.json();
        dadosDashboard.congestionamento = await resCong.json();
        dadosDashboard.tiposOS          = await resTipos.json();

        popularFiltroTipos();
        renderizarCardsDashboard();
        renderizarGraficoVolume();
        renderizarGraficoProdutividade();
        renderizarHeatmap();

    } catch (erro) {
        console.error('Erro ao carregar dashboard:', erro);
    }
}

function aplicarFiltros() {
    filtrosDashboard.dias        = parseInt(document.getElementById('filtro-dias').value);
    filtrosDashboard.deposito_id = document.getElementById('filtro-deposito').value || null;
    filtrosDashboard.tipo_os     = document.getElementById('filtro-tipo-os').value || null;
    carregarDashboard();
}

function popularFiltroTipos() {
    const sel = document.getElementById('filtro-tipo-os');
    const selProd = document.getElementById('filtro-prod-tipo');
    const tipoAtual = sel.value;

    // Limpa e repopula mantendo seleção
    [sel, selProd].forEach(s => {
        const primeiro = s.options[0];
        s.innerHTML = '';
        s.appendChild(primeiro);
        dadosDashboard.tiposOS.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.codigo;
            opt.textContent = t.descricao;
            s.appendChild(opt);
        });
    });
    sel.value = tipoAtual;
}

function renderizarCardsDashboard() {
    const r = dadosDashboard.resumo;
    if (!r) return;

    document.getElementById('dashboard-cards').innerHTML = `
        <div class="dash-card">
            <div class="dash-card-valor">${r.total_execucoes}</div>
            <div class="dash-card-label">OS Executadas</div>
        </div>
        <div class="dash-card">
            <div class="dash-card-valor">${r.total_operadores}</div>
            <div class="dash-card-label">Operadores Ativos</div>
        </div>
        <div class="dash-card">
            <div class="dash-card-valor">${r.tempo_medio_min} min</div>
            <div class="dash-card-label">Tempo Médio de Execução</div>
        </div>
        <div class="dash-card">
            <div class="dash-card-valor">${r.tempo_min_min} min</div>
            <div class="dash-card-label">Menor Tempo</div>
        </div>
        <div class="dash-card">
            <div class="dash-card-valor">${r.tempo_max_min} min</div>
            <div class="dash-card-label">Maior Tempo</div>
        </div>
    `;
}

// Instâncias dos gráficos para destruir ao recriar
let chartVolume = null;
let chartProd   = null;

function renderizarGraficoVolume() {
    const ctx = document.getElementById('grafico-volume');
    if (!ctx) return;
    if (chartVolume) chartVolume.destroy();

    // Agrupa volume por tipo
    const totais = {};
    dadosDashboard.volume.forEach(d => {
        totais[d.tipo_os] = (totais[d.tipo_os] || 0) + d.total;
    });

    const labels = Object.keys(totais);
    const valores = Object.values(totais);
    const cores = ['#4f8ef7','#f39c12','#2ecc71','#e74c3c','#9b59b6','#1abc9c'];

    chartVolume = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: valores,
                backgroundColor: cores.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'right' }
            }
        }
    });
}

function renderizarGraficoProdutividade() {
    const ctx = document.getElementById('grafico-produtividade');
    if (!ctx) return;
    if (chartProd) chartProd.destroy();

    const tipoFiltro = document.getElementById('filtro-prod-tipo')?.value || '';
    let dados = dadosDashboard.produtividade;
    if (tipoFiltro) {
        dados = dados.filter(d => String(d.tipo_os) === String(
            dadosDashboard.tiposOS.find(t => String(t.codigo) === tipoFiltro)?.descricao || tipoFiltro
        ));
    }

    // Top 15 operadores por tempo médio
    const top15 = dados.slice(0, 15);
    const labels = top15.map(d => d.operador.split(' ').slice(-1)[0]);
    const valores = top15.map(d => d.tempo_medio_min);

    chartProd = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Tempo médio (min)',
                data: valores,
                backgroundColor: '#4f8ef7',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Minutos' } }
            }
        }
    });
}

function renderizarHeatmap() {
    const container = document.getElementById('grafico-heatmap');
    if (!container) return;

    const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const horas = Array.from({length: 13}, (_, i) => i + 6); // 6h às 18h

    // Indexa dados
    const idx = {};
    dadosDashboard.congestionamento.forEach(d => {
        idx[`${d.dia_semana}-${d.hora}`] = d.total_execucoes;
    });

    const maxVal = Math.max(...Object.values(idx), 1);

    let html = '<div class="heatmap-grid">';
    html += '<div class="heatmap-corner"></div>';
    horas.forEach(h => { html += `<div class="heatmap-hora">${h}h</div>`; });

    dias.forEach((dia, di) => {
        html += `<div class="heatmap-dia">${dia}</div>`;
        horas.forEach(h => {
            const val = idx[`${di}-${h}`] || 0;
            const intensidade = val / maxVal;
            const bg = val === 0
                ? '#f0f2f5'
                : `rgba(79, 142, 247, ${0.15 + intensidade * 0.85})`;
            html += `
                <div class="heatmap-celula" style="background:${bg}" title="${dia} ${h}h: ${val} execuções">
                    ${val > 0 ? val : ''}
                </div>
            `;
        });
    });

    html += '</div>';
    container.innerHTML = html;
}