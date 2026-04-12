# SAD — Sistema de Apoio à Decisão para Logística Interna

> Projeto em desenvolvimento - modelagem, análise exploratória e motor de decisão para otimização de picking em armazéns.

---

## Problema

Em operações de separação de pedidos (picking), a atribuição de Ordens de Serviço (OS) aos operadores geralmente é feita de forma manual ou por fila simples. Isso ignora fatores críticos como:

- **Posição atual do operador** no armazém
- **Saturação de zonas** com múltiplos operadores simultâneos
- **Histórico de performance** por tipo de OS
- **Custo de congestionamento** entre operadores na mesma região

O resultado são atrasos evitáveis, gargalos e uso ineficiente da equipe.

---

## Solução

Um **SAD (Sistema de Apoio à Decisão)** que, dado um conjunto de OS pendentes e operadores disponíveis, calcula um **score de atraso esperado** para cada combinação e sugere a atribuição que minimiza o tempo total da operação.

O sistema **não decide automaticamente** - ele sugere com justificativa, mantendo o gestor no controle.

---

## Arquitetura

```
sad-logistica/
│
├── schema.sql                        # Modelagem do banco PostgreSQL
├── .gitignore
│
├── dados/
│   └── gerar_dados.py                # Geração de dados sintéticos (90 dias)
│
├── notebooks/
│   ├── 01_analise_exploratoria.ipynb # EDA completa
│   └── 02_motor_de_score.ipynb       # Em desenvolvimento
│
└── src/
    └── score.py                      # Motor de score v1
```

---

## Modelagem de Dados

O banco reflete a realidade de um armazém com dois depósitos:

| Tabela | Descrição |
|---|---|
| `depositos` | Depósito solo (térreo) e elevado (empilhadeira) |
| `os_tipos` | Tipos de OS com código numérico e escopo de métrica |
| `enderecos` | Posição física: Depósito > Rua > Prédio > Nível > Apartamento |
| `produtos` | Cadastro com dados logísticos do fabricante |
| `estoque` | Localização e quantidade de cada produto |
| `operadores` | Cadastro de operadores ativos |
| `os` | Ordens de Serviço com status e tipo |
| `os_itens` | Itens da OS com controle de quantidade por destino |
| `execucoes` | Histórico completo de atribuições e reatribuições |

### Destaques da modelagem

**Controle de quantidade por item:**
```
qt_total = qt_finalizada + qt_cortada + qt_cancelada
```
Quando essa equação fecha para todos os itens → OS pode finalizar.

**Reatribuição rastreada:**
Cada atribuição gera uma linha em `execucoes`. Uma OS reatribuída terá duas linhas; a cancelada e a finalizada, preservando o histórico completo.

**Dados logísticos provisórios:**
Produtos sem dados do fabricante recebem valor padrão (0.2) com flag `dado_provisorio = TRUE` para controle de qualidade.

---

## Motor de Score (v1)

Para cada combinação `(operador, OS pendente)`, o motor calcula:

```
score = tempo_base + custo_distancia + custo_congestao
```

**tempo_base** - média histórica do operador para aquele tipo de OS. Se o operador nunca executou aquele tipo, usa a média dos operadores que já fizeram (fallback). Se ninguém fez, usa a média geral.

**custo_distancia** - distância ponderada entre posição estimada do operador e centroide da OS:
```
abs(rua_a - rua_b)    * 3   +
abs(predio_a - predio_b) * 2   +
abs(nivel_a - nivel_b)   * 1   +
abs(apto_a - apto_b)     * 0.2
```
Os pesos refletem o custo real de locomoção - mudar de rua é mais custoso que mudar de apartamento.

**custo_congestao** - número de operadores ativos na mesma zona × 60 segundos. Em produção usa `vw_operadores_ativos`. Nos dados sintéticos usa todos os operadores do depósito como proxy.

A atribuição sugerida é a de **menor score**, com alternativa apresentada.

---

## Análise Exploratória

### Distribuição de OS por tipo
Separação Carrinho Fracionado representa ~40% do volume, seguida de Paletizado (~23%).

### Tempos médios por tipo
| Tipo | Tempo médio |
|---|---|
| Separação Carrinho Fracionado | ~15 min |
| Separação Paletizado Caixa Fechada | ~30 min |
| Armazenagem de Produtos | ~23 min |
| Separação Empilhadeira/Transpaleteira | ~40 min |
| Recebimento de Mercadoria | ~65 min |

### Qualidade dos dados
- **15 registros** com tempo suspeito detectados (< 1 min ou > 2h)
- **26.5% dos produtos** com dados logísticos provisórios

### Reatribuições
- Taxa de **11.2%** de reatribuição de OS
- Máximo de **6 operadores simultâneos** detectado por execução

---

## Limitações do modelo

- **Dados sintéticos** — padrões são controlados, não descobertos organicamente
- **Posição estimada** — sem rastreamento em tempo real, usa centroide da última OS como proxy
- **Custo de congestionamento** — em produção precisa de execuções ativas reais
- **Causalidade vs correlação** — o modelo detecta padrões, mas não isola causa com certeza
- **Sistema sugestivo** — não substitui o julgamento do gestor operacional

---

## Tecnologias

- **PostgreSQL** — banco de dados relacional
- **Python** — geração de dados, análise e motor de score
- **pandas** — manipulação de dados
- **matplotlib / seaborn** — visualizações
- **SQLAlchemy / psycopg** — conexão Python <-> PostgreSQL
- **Jupyter Notebook** — análise exploratória documentada

---

## Como rodar

### 1. Banco de dados
```bash
# No pgAdmin, crie o banco sad_logistica e execute:
psql -U postgres -d sad_logistica -f schema.sql
```

### 2. Dependências Python
```bash
pip install psycopg[binary] pandas matplotlib seaborn sqlalchemy faker jupyter
```

### 3. Variáveis de ambiente
```bash
# Windows
set DB_PASSWORD=sua_senha
set DB_PORT=5433

# Linux/Mac
export DB_PASSWORD=sua_senha
export DB_PORT=5433
```

### 4. Gerar dados sintéticos
```bash
python dados/gerar_dados.py
```

### 5. Análise exploratória
```bash
jupyter notebook notebooks/01_analise_exploratoria.ipynb
```

### 6. Motor de score
```bash
python src/score.py
```

---

## Roadmap

### Fase 1 — Fundação (concluída)
- [x] Modelagem do banco de dados
- [x] Geração de dados sintéticos com problemas de qualidade propositais
- [x] Análise exploratória completa
- [x] Motor de score v1 (tempo base + distância + congestionamento)

### Fase 2 — Motor de score melhorado (em desenvolvimento)
- [ ] Usar `vw_operadores_ativos` para congestionamento real
- [ ] Considerar tempo estimado de chegada na zona
- [ ] Calibrar pesos da função de distância com dados reais
- [ ] Notebook documentado do motor de score

### Fase 3 — Interface
- [ ] Dashboard de indicadores operacionais
  - Tempo médio por operador e tipo de OS
  - Taxa de reatribuição
  - Operadores mais rápidos por tipo
  - Zonas mais congestionadas
- [ ] Página interativa de sugestão de atribuição

### Fase 4 — Modelo preditivo
- [ ] Regressão linear como baseline
- [ ] Random Forest para capturar não-linearidades
- [ ] Avaliação e comparação de modelos
- [ ] Previsão de tempo antes da execução

---

## Autor

Projeto desenvolvido como estudo de otimização logística e ciência de dados aplicada a operações de armazém.
