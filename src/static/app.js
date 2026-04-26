// app.js
// Navegação entre páginas via DOM e inicialização dos módulos

document.addEventListener('DOMContentLoaded', () => {
    // Inicializa a primeira página
    carregarPagina('lista-os');

    // Adiciona evento de clique em todos os itens do menu
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const pagina = item.getAttribute('data-pagina');
            carregarPagina(pagina);
        });
    });
});


function carregarPagina(nomePagina) {
    // Esconde todas as páginas
    document.querySelectorAll('.pagina').forEach(p => {
        p.classList.remove('ativa');
    });

    // Remove destaque de todos os itens do menu
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('ativo');
    });

    // Mostra a página selecionada
    const pagina = document.getElementById(`pagina-${nomePagina}`);
    if (pagina) pagina.classList.add('ativa');

    // Destaca o item do menu correspondente
    const menuItem = document.querySelector(`[data-pagina="${nomePagina}"]`);
    if (menuItem) menuItem.classList.add('ativo');

    // Chama a função de inicialização do módulo correspondente
    const inicializadores = {
        'lista-os':     () => typeof inicializarListaOS     === 'function' && inicializarListaOS(),
        'mapa':         () => typeof inicializarMapa        === 'function' && inicializarMapa(),
        'configuracao': () => typeof inicializarConfiguracao === 'function' && inicializarConfiguracao(),
        'atribuicao':   () => typeof inicializarAtribuicao  === 'function' && inicializarAtribuicao(),
    };

    if (inicializadores[nomePagina]) inicializadores[nomePagina]();
}