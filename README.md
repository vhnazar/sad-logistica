# SAD - Sistema de Apoio à Decisão para Logística Interna

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
│   └── 02_motor_de_score.ipynb       # Demonstração do motor de score
│
└── src/
    ├── config.py                     # Configurações físicas do armazém
    └── score.py                      # Motor de score v5
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

## Motor de Score (v5)

Para cada combinação `(operador, OS pendente)`, o motor calcula:

```
score = tempo_base + custo_distancia + custo_congestao
```

**tempo_base** - média histórica do operador para aquele tipo de OS. Fallback para média do tipo se o operador nunca executou aquele tipo, ou média geral se ninguém executou.

**custo_distancia** - tempo real de deslocamento em segundos, calculado com roteamento contínuo rua a rua:
- Ruas com itens: percorre os prédios até cada item e sai pelo final da rua
- Ruas sem itens: apenas o custo de travessia do corredor
- Dimensões físicas configuráveis em `config.py` (largura de prédios, corredores, apartamentos, custo por nível)

**custo_congestao** - soma do tempo restante estimado de cada operador ativo na mesma zona. Calculado com base no tempo decorrido desde o início da execução ativa versus o tempo médio histórico do operador.

Regras adicionais:
- Um operador só pode ser sugerido para uma OS por rodada
- Operadores de depósito incompatível com o tipo de OS são automaticamente excluídos
- A sugestão inclui uma alternativa caso o gestor queira substituir

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

- **Dados sintéticos** - padrões são controlados, não descobertos organicamente
- **Posição estimada** - sem rastreamento em tempo real, usa centroide da última OS como proxy
- **Custo de congestionamento** - em produção precisa de execuções ativas reais
- **Causalidade vs correlação** - o modelo detecta padrões, mas não isola causa com certeza
- **Sistema sugestivo** - não substitui o julgamento do gestor operacional
- **Restrição de nível por tipo de operador** - o modelo não restringe operadores de separação fracionada (solo) de receberem OS com itens em níveis elevados. Em produção essa regra deve ser implementada no filtro de compatibilidade de depósito.

---

## Tecnologias

- **PostgreSQL** - banco de dados relacional
- **Python** - geração de dados, análise e motor de score
- **pandas** - manipulação de dados
- **matplotlib / seaborn** - visualizações
- **SQLAlchemy / psycopg** - conexão Python ↔ PostgreSQL
- **Jupyter Notebook** - análise exploratória documentada

---

## Como rodar

### 1. Banco de dados
```bash
# No pgAdmin, crie o banco sad_logistica e execute:
psql -U postgres -d sad_logistica -f schema.sql
```

### 2. Dependências Python
```bash
pip install psycopg[binary] pandas matplotlib seaborn sqlalchemy faker jupyter python-dotenv
```

### 3. Variáveis de ambiente
Crie um arquivo `.env` na raiz do projeto:
```
DB_USER=postgres
DB_PASSWORD=sua_senha
DB_HOST=localhost
DB_PORT=5433
DB_NAME=sad_logistica
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

### Fase 1 - Fundação (concluída)
- [x] Modelagem do banco de dados
- [x] Geração de dados sintéticos com problemas de qualidade propositais
- [x] Análise exploratória completa
- [x] Motor de score v1 (tempo base + distância + congestionamento)

### Fase 2 — Motor de score melhorado (concluída)
- [x] Congestionamento dinâmico com vw_operadores_ativos
- [x] Distância real por item com dimensões físicas do armazém
- [x] Roteamento contínuo rua a rua com custo de travessia real
- [x] Alocação única por rodada
- [x] Apresentação de tempo em formato legível
- [x] Configurações do armazém externalizadas em config.py
- [x] Notebook documentado do motor de score

### Fase 3 - Interface
- [ ] Dashboard de indicadores operacionais
  - Tempo médio por operador e tipo de OS
  - Taxa de reatribuição
  - Operadores mais rápidos por tipo
  - Zonas mais congestionadas
- [ ] Página interativa de sugestão de atribuição

### Fase 4 - Modelo preditivo
- [ ] Regressão linear como baseline
- [ ] Random Forest para capturar não-linearidades
- [ ] Avaliação e comparação de modelos
- [ ] Previsão de tempo antes da execução

---

## Autor

Projeto desenvolvido como estudo de otimização logística e ciência de dados aplicada a operações de armazém.
