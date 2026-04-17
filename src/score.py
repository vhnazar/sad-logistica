import os
import pandas as pd
from sqlalchemy import create_engine
from urllib.parse import quote_plus
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")

if not all([DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME]):
    raise ValueError("Variáveis de ambiente do banco não configuradas corretamente")

DB_PASSWORD = quote_plus(DB_PASSWORD)

engine = create_engine(
    f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

def buscar_operadores():
    query = """
        WITH ultima_os AS (
            SELECT DISTINCT ON (ex.operador_id)
                ex.operador_id,
                ex.os_id,
                ex.fim
            FROM execucoes ex
            WHERE ex.status = 'finalizada'
            ORDER BY ex.operador_id, ex.fim DESC
        )
        SELECT
            op.id,
            op.nome,
            u.os_id,
            MAX(ed.deposito_id) AS deposito_id,
            AVG(ed.rua)         AS rua_media,
            AVG(ed.predio)      AS predio_media,
            AVG(ed.nivel)       AS nivel_media,
            AVG(ed.apartamento) AS apto_media,
            u.fim               AS ultima_execucao
        FROM operadores op
        JOIN ultima_os u  ON u.operador_id = op.id
        JOIN os_itens oi  ON oi.os_id = u.os_id
        JOIN enderecos ed ON ed.id = oi.endereco_id
        WHERE op.ativo = TRUE
        GROUP BY op.id, op.nome, u.os_id, u.fim
    """
    return pd.read_sql_query(query, engine)


def buscar_baseline():
    query = """
        SELECT
            op.id          AS matricula,
            op.nome        AS funcionario,
            st.codigo      AS codigo_os,
            st.descricao   AS tipo_os,
            AVG(ex.tempo_segundos) AS tempo_medio
        FROM operadores op
        JOIN execucoes ex ON ex.operador_id = op.id
        JOIN os s         ON s.id = ex.os_id
        JOIN os_tipos st  ON st.codigo = s.tipo_codigo
        WHERE ex.tempo_segundos BETWEEN 60 AND 7200
          AND ex.status = 'finalizada'
        GROUP BY op.id, op.nome, st.codigo, st.descricao
    """
    return pd.read_sql_query(query, engine)


def buscar_os_pendentes():
    query = """
        SELECT
            o.id           AS os_id,
            o.tipo_codigo,
            ot.descricao   AS tipo_os,
            MAX(ed.deposito_id) AS deposito_id,
            AVG(ed.rua)         AS rua_media,
            AVG(ed.predio)      AS predio_media,
            AVG(ed.nivel)       AS nivel_media,
            AVG(ed.apartamento) AS apto_media
        FROM os o
        JOIN os_tipos ot ON ot.codigo = o.tipo_codigo
        JOIN os_itens oi ON oi.os_id = o.id
        JOIN enderecos ed ON ed.id = oi.endereco_id
        WHERE o.status = 'pendente'
        GROUP BY o.id, o.tipo_codigo, ot.descricao
    """
    return pd.read_sql_query(query, engine)

def buscar_operadores_ativos():
	query = """
		SELECT 
            ex.operador_id,
            op.nome,
            ex.os_id,
            MAX(ed.deposito_id) AS deposito_id,
            AVG(ed.rua)         AS rua_media,
            AVG(ed.predio)      AS predio_media,
            AVG(ed.nivel)       AS nivel_media,
            AVG(ed.apartamento) AS apto_media
        FROM vw_operadores_ativos v
        JOIN execucoes ex  ON ex.os_id = v.os_id
          AND ex.operador_id = v.operador_id
        JOIN os_itens oi   ON oi.os_id = ex.os_id
        JOIN enderecos ed  ON ed.id = oi.endereco_id
        JOIN operadores op ON op.id = ex.operador_id
        GROUP BY ex.operador_id, op.nome, ex.os_id
	"""
	return pd.read_sql_query(query, engine)

def calcular_distancia(op, os):
    """
    Distância ponderada entre posição do operador e centroide da OS.
    Pesos refletem o custo real de locomoção no armazém:
      - Rua        → maior deslocamento → peso 3
      - Prédio     → deslocamento médio → peso 2
      - Nível      → deslocamento menor → peso 1
      - Apartamento→ mínimo            → peso 0.2
    ABS garante magnitude sem direção.
    """
    return (
        abs(op["rua_media"]    - os["rua_media"])    * 3   +
        abs(op["predio_media"] - os["predio_media"]) * 2   +
        abs(op["nivel_media"]  - os["nivel_media"])  * 1   +
        abs(op["apto_media"]   - os["apto_media"])   * 0.2
    )


def calcular_score(operador, os_row, baseline, operadores_ativos):
    # 1. Tempo base do operador para esse tipo de OS
    filtro = (
        (baseline["matricula"] == operador["id"]) &
        (baseline["codigo_os"] == os_row["tipo_codigo"])
    )
    historico = baseline[filtro]

    if historico.empty:
        # Fallback: média dos operadores que já fizeram esse tipo de OS.
        # Evita que operador sem histórico tenha tempo_base=0, o que distorce o score.
        fallback = baseline[
            baseline["codigo_os"] == os_row["tipo_codigo"]
        ]["tempo_medio"].mean()

        # Se ninguém nunca fez esse tipo, usa média geral
        tempo_base = fallback if not pd.isna(fallback) else baseline["tempo_medio"].mean()
    else:
        tempo_base = historico["tempo_medio"].values[0]
        if  pd.isna(tempo_base):
            tempo_base = baseline["tempo_medio"].mean()

    # 2. Custo de distância entre operador e OS
    custo_distancia = calcular_distancia(operador, os_row)

    # 3. Custo de congestionamento
    # Conta operadores no mesmo depósito (mesma zona)
    # O custo de congestão usa a vw_operadores_ativos para considerar execuções em andamento. Mas nos dados sintéticos todas as execuções estão finalizadas, então ele usa a tabela operadores e pega os dados como proxy.
    # Cada operador adicional representa ~60s de atraso esperado
    mesmo_deposito = operadores_ativos[
        (operadores_ativos["deposito_id"] == os_row["deposito_id"]) &
        (operadores_ativos["operador_id"] != operador["id"])
    ]
    custo_congestao = len(mesmo_deposito) * 60

    # Score final: menor = melhor atribuição
    score = tempo_base + custo_distancia + custo_congestao

    return {
        "operador_id":      operador["id"],
        "operador_nome":    operador["nome"],
        "os_id":            os_row["os_id"],
        "tipo_os":          os_row["tipo_os"],
        "tempo_base_seg":   int(round(tempo_base, 1)),
        "custo_distancia":  round(custo_distancia, 2),
        "custo_congestao":  custo_congestao,
        "score":            round(score, 1)
    }

def formatar_tempo(segundos):
    # Formata segundos em h/m/s
    horas = segundos // 3600
    minutos = (segundos % 3600) // 60
    seg = segundos % 60

    if horas:
        return f"{horas}h {minutos}m {seg}s"
    if minutos:
        return f"{minutos}m {seg}s"
    return f"{seg}s"

def sugerir_atribuicoes():
    operadores   = buscar_operadores()
    operadores_ativos   = buscar_operadores_ativos()
    baseline     = buscar_baseline()
    os_pendentes = buscar_os_pendentes()

    alocados = set()  # Para rastrear operadores já alocados nesta rodada
    resultados = []

    for _, os_row in os_pendentes.iterrows():
        scores_os = []

        for _, operador in operadores.iterrows():
            # Evita sugerir operador já alocado para outra OS
            if operador["id"] in alocados:
                continue
            # Só sugere operador compatível com o depósito da OS
            if operador["deposito_id"] != os_row["deposito_id"]:
                continue

            score = calcular_score(operador, os_row, baseline, operadores_ativos)
            if score is None:
                continue
            scores_os.append(score)

        if scores_os:
            scores_os.sort(key=lambda x: x["score"])
            melhor = scores_os[0]
            melhor["alternativa"] = (
                scores_os[1]["operador_nome"] if len(scores_os) > 1 else "-"
            )
            resultados.append(melhor)
            alocados.add(melhor["operador_id"])

    return pd.DataFrame(resultados)


# Executa
sugestoes = sugerir_atribuicoes()

sugestoes["tempo_base_formatado"] = sugestoes["tempo_base_seg"].apply(formatar_tempo)

# Reordena colunas
sugestoes = sugestoes[[
    "operador_id",
    "operador_nome",
    "os_id",
    "tipo_os",
    "tempo_base_seg",
    "tempo_base_formatado",
    "custo_distancia",
    "custo_congestao",
    "score",
    "alternativa"
]]

print("\n=== SUGESTÕES DE ATRIBUIÇÃO ===\n")
print(sugestoes.to_string(index=False))