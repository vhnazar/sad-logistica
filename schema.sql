-- =============================================================
-- SAD - Sistema de Apoio à Decisão para Logística Interna
-- Schema PostgreSQL - Versão Final
-- =============================================================
-- Convenções:
--   - Timestamps sempre em UTC
--   - Campos de quantidade nunca negativos (CHECK constraint)
--   - Dados logísticos preenchidos (padrão 0.2 se desconhecido)
--   - Flag 'dado_provisorio' indica se valor é do fabricante ou estimado
-- =============================================================


-- -------------------------------------------------------------
-- 1. DEPÓSITOS
-- Depósito 1 = solo (operadores de separação)
-- Depósito 2 = elevado (operadores de empilhadeira)
-- -------------------------------------------------------------
CREATE TABLE depositos (
  id    SERIAL PRIMARY KEY,
  nome  TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE
);


-- -------------------------------------------------------------
-- 2. TIPOS DE OS
-- Código numérico identificador com descrição
-- Permite escalar novos tipos sem alterar estrutura
--
-- entra_metrica = FALSE para OS fora do escopo do motor de score
--   (devolução, recebimento, etc)
-- deposito_tipo = restrição de qual tipo de operador executa
--   'solo' | 'elevado' | 'ambos'
-- -------------------------------------------------------------
CREATE TABLE os_tipos (
  codigo        INT PRIMARY KEY,
  descricao     TEXT NOT NULL,
  categoria     TEXT NOT NULL,
    -- 'separacao' | 'armazenagem' | 'devolucao' | 'recebimento'
  deposito_tipo TEXT NOT NULL,
    -- 'solo' | 'elevado' | 'ambos'
  entra_metrica BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO os_tipos VALUES
  (1,   'Separação Carrinho Fracionado',         'separacao',   'solo',    TRUE),
  (9,   'Separação Paletizado Caixa Fechada',    'separacao',   'solo',    TRUE),
  (23,  'Separação Empilhadeira/Transpaleteira', 'separacao',   'elevado', TRUE),
  (88,  'Armazenagem de Produtos',               'armazenagem', 'ambos',   TRUE),
  (99,  'Devolução de Itens',                    'devolucao',   'ambos',   FALSE),
  (123, 'Recebimento de Mercadoria',             'recebimento', 'ambos',   FALSE);


-- -------------------------------------------------------------
-- 3. ENDEREÇOS
-- Posição física única dentro de um depósito
-- Hierarquia: Depósito > Rua > Prédio > Nível > Apartamento
-- -------------------------------------------------------------
CREATE TABLE enderecos (
  id           SERIAL PRIMARY KEY,
  deposito_id  INT NOT NULL REFERENCES depositos(id),
  rua          INT NOT NULL,
  predio       INT NOT NULL,
  nivel        INT NOT NULL,
  apartamento  INT NOT NULL,

  UNIQUE (deposito_id, rua, predio, nivel, apartamento)
);


-- -------------------------------------------------------------
-- 4. PRODUTOS
-- Dados logísticos preenchidos
-- dado_provisorio = TRUE quando valor é padrão (0.2), aguardando dado real
-- -------------------------------------------------------------
CREATE TABLE produtos (
  id               SERIAL PRIMARY KEY,
  codigo           TEXT UNIQUE NOT NULL,
  nome             TEXT NOT NULL,

  peso_bruto_kg    NUMERIC(10,3) NOT NULL DEFAULT 0.2,
  peso_liquido_kg  NUMERIC(10,3) NOT NULL DEFAULT 0.2,
  altura_cm        NUMERIC(10,2) NOT NULL DEFAULT 0.2,
  largura_cm       NUMERIC(10,2) NOT NULL DEFAULT 0.2,
  comprimento_cm   NUMERIC(10,2) NOT NULL DEFAULT 0.2,

  -- Calculado automaticamente
  volume_cm3       NUMERIC(15,2) GENERATED ALWAYS AS
                     (altura_cm * largura_cm * comprimento_cm) STORED,

  dado_provisorio  BOOLEAN NOT NULL DEFAULT TRUE,
  revisado_em      TIMESTAMP,
  revisado_por     TEXT,

  ativo            BOOLEAN NOT NULL DEFAULT TRUE
);


-- -------------------------------------------------------------
-- 5. ESTOQUE
-- Um produto pode estar em múltiplos endereços
-- -------------------------------------------------------------
CREATE TABLE estoque (
  produto_id   INT NOT NULL REFERENCES produtos(id),
  endereco_id  INT NOT NULL REFERENCES enderecos(id),
  quantidade   INT NOT NULL DEFAULT 0 CHECK (quantidade >= 0),

  PRIMARY KEY (produto_id, endereco_id)
);


-- -------------------------------------------------------------
-- 6. OPERADORES
-- -------------------------------------------------------------
CREATE TABLE operadores (
  id    SERIAL PRIMARY KEY,
  nome  TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE
);


-- -------------------------------------------------------------
-- 7. ORDENS DE SERVIÇO (OS)
-- -------------------------------------------------------------
CREATE TABLE os (
  id             SERIAL PRIMARY KEY,
  tipo_codigo    INT NOT NULL REFERENCES os_tipos(codigo),
  status         TEXT NOT NULL DEFAULT 'pendente',
    -- pendente | em_andamento | finalizada | cancelada
  criado_em      TIMESTAMP NOT NULL DEFAULT NOW(),
  finalizado_em  TIMESTAMP,

  CHECK (
    (status = 'finalizada' AND finalizado_em IS NOT NULL) OR
    (status != 'finalizada' AND finalizado_em IS NULL)
  )
);


-- -------------------------------------------------------------
-- 8. ITENS DA OS
--
-- Regra de fechamento:
--   qt_total = qt_finalizada + qt_cortada + qt_cancelada
--   Quando essa equação fechar para TODOS os itens → OS finaliza
--
-- Coleta parcial é permitida:
--   Ex: pediu 10, coletou 7 (dt_finalizacao), cortou 3 (dt_corte)
-- -------------------------------------------------------------
CREATE TABLE os_itens (
  id              SERIAL PRIMARY KEY,
  os_id           INT NOT NULL REFERENCES os(id),
  produto_id      INT NOT NULL REFERENCES produtos(id),
  endereco_id     INT NOT NULL REFERENCES enderecos(id),

  qt_total        INT NOT NULL CHECK (qt_total > 0),
  qt_finalizada   INT NOT NULL DEFAULT 0 CHECK (qt_finalizada >= 0),
  qt_cortada      INT NOT NULL DEFAULT 0 CHECK (qt_cortada >= 0),
  qt_cancelada    INT NOT NULL DEFAULT 0 CHECK (qt_cancelada >= 0),

  CHECK (qt_finalizada + qt_cortada + qt_cancelada <= qt_total),

  dt_finalizacao  TIMESTAMP,
  dt_corte        TIMESTAMP,
  dt_cancelamento TIMESTAMP
);


-- -------------------------------------------------------------
-- 9. EXECUÇÕES
-- Histórico completo de atribuições e reatribuições
--
-- Reatribuição gera múltiplas linhas para a mesma OS:
--   os_id=42 | operador_id=3 | status=cancelada | inicio=09:00 | fim=09:40
--   os_id=42 | operador_id=7 | status=finalizada | inicio=09:45 | fim=10:20
-- -------------------------------------------------------------
CREATE TABLE execucoes (
  id                     SERIAL PRIMARY KEY,
  os_id                  INT NOT NULL REFERENCES os(id),
  operador_id            INT NOT NULL REFERENCES operadores(id),

  status                 TEXT NOT NULL DEFAULT 'ativa',
    -- ativa | finalizada | cancelada

  inicio                 TIMESTAMP NOT NULL DEFAULT NOW(),
  fim                    TIMESTAMP,
  tempo_segundos         INT CHECK (tempo_segundos >= 0),

  -- Snapshot do momento da atribuição
  itens_pendentes_inicio INT CHECK (itens_pendentes_inicio >= 0),
  itens_finalizados      INT CHECK (itens_finalizados >= 0),

  CHECK (
    (status = 'ativa'  AND fim IS NULL     AND tempo_segundos IS NULL) OR
    (status != 'ativa' AND fim IS NOT NULL AND tempo_segundos IS NOT NULL)
  )
);


-- =============================================================
-- VIEWS
-- =============================================================

-- Posição estimada do operador = centroide da última OS executada
CREATE VIEW vw_posicao_operadores AS
SELECT
  op.id AS operador_id,
  op.nome,
  ex.os_id AS ultima_os,
  ex.fim   AS ultimo_fim,
  AVG(e.rua)       AS x_estimado,
  AVG(e.predio)    AS y_estimado,
  AVG(e.nivel)     AS z_estimado,
  e.deposito_id
FROM operadores op
JOIN execucoes ex ON ex.operador_id = op.id
  AND ex.fim = (
    SELECT MAX(fim) FROM execucoes
    WHERE operador_id = op.id AND status = 'finalizada'
  )
JOIN os_itens oi ON oi.os_id = ex.os_id
JOIN enderecos e  ON e.id = oi.endereco_id
WHERE op.ativo = TRUE
GROUP BY op.id, op.nome, ex.os_id, ex.fim, e.deposito_id;


-- Centroide de cada OS
CREATE VIEW vw_centroide_os AS
SELECT
  oi.os_id,
  e.deposito_id,
  AVG(e.rua)       AS x,
  AVG(e.predio)    AS y,
  AVG(e.nivel)     AS z,
  COUNT(oi.id)     AS total_itens,
  SUM(p.volume_cm3 * oi.qt_total) AS volume_total_cm3
FROM os_itens oi
JOIN enderecos e ON e.id = oi.endereco_id
JOIN produtos p  ON p.id = oi.produto_id
GROUP BY oi.os_id, e.deposito_id;


-- Operadores com execução ativa agora
CREATE VIEW vw_operadores_ativos AS
SELECT
  ex.operador_id,
  op.nome,
  ex.os_id,
  ex.inicio,
  EXTRACT(EPOCH FROM (NOW() - ex.inicio)) / 60 AS minutos_em_execucao
FROM execucoes ex
JOIN operadores op ON op.id = ex.operador_id
WHERE ex.status = 'ativa';


-- Baseline de tempo por operador por tipo de OS
-- Base principal do motor de score
CREATE VIEW vw_baseline_operadores AS
SELECT
  ex.operador_id,
  op.nome,
  ot.codigo    AS tipo_codigo,
  ot.descricao AS tipo_descricao,
  COUNT(*)                  AS total_execucoes,
  AVG(ex.tempo_segundos)    AS tempo_medio_seg,
  STDDEV(ex.tempo_segundos) AS desvio_padrao_seg,
  MIN(ex.tempo_segundos)    AS tempo_min_seg,
  MAX(ex.tempo_segundos)    AS tempo_max_seg
FROM execucoes ex
JOIN operadores op ON op.id = ex.operador_id
JOIN os            ON os.id = ex.os_id
JOIN os_tipos ot   ON ot.codigo = os.tipo_codigo
WHERE ex.status = 'finalizada'
  AND ex.tempo_segundos IS NOT NULL
GROUP BY ex.operador_id, op.nome, ot.codigo, ot.descricao;


-- -------------------------------------------------------------
-- 10. RESERVAS DE OS
-- Controla OS reservadas para operadores específicos pelo gestor
-- Uma OS só pode ter uma reserva ativa por vez
-- Reservas não bloqueiam a OS — apenas a identificam como reservada
-- e a excluem do escopo de sugestão automática
-- -------------------------------------------------------------
CREATE TABLE os_reservas (
  id            SERIAL PRIMARY KEY,
  os_id         INT NOT NULL REFERENCES os(id),
  operador_id   INT NOT NULL REFERENCES operadores(id),
  reservado_em  TIMESTAMP NOT NULL DEFAULT NOW(),
  expira_em     TIMESTAMP,
  reservado_por TEXT,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,

  UNIQUE (os_id, ativo)
);

-- View para facilitar consulta de reservas ativas
CREATE VIEW vw_os_reservadas AS
SELECT
  r.os_id,
  r.operador_id,
  op.nome AS operador_nome,
  r.reservado_em,
  r.expira_em,
  r.reservado_por
FROM os_reservas r
JOIN operadores op ON op.id = r.operador_id
WHERE r.ativo = TRUE;