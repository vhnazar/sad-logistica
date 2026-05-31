
import os
import sys
from pathlib import Path
from urllib.parse import quote_plus
from typing import Optional
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import create_engine, text

load_dotenv()
sys.path.insert(0, str(Path(__file__).parent))

from score import sugerir_atribuicoes, buscar_operadores
from regras import aplicar_regras
from rota import otimizar_rota

load_dotenv(Path(__file__).parent.parent / ".env")

db_password = quote_plus(os.getenv("DB_PASSWORD"))
engine = create_engine(
    f"postgresql+psycopg2://{os.getenv('DB_USER')}:{db_password}@"
    f"{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
)

app = FastAPI(title="SAD Logística")

# Arquivos estáticos (HTML, CSS, JS)
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")

# Modelos de dados
class ReservaRequest(BaseModel):
    os_id: int
    operador_id: int
    reservado_por: str = "gestor"  # default por enquanto

class AtribuicaoRequest(BaseModel):
    os_id: int
    operador_id: int
    
# ROTAS

@app.get("/")
def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/os/pendentes")
def get_os_pendentes():
    sugestoes = sugerir_atribuicoes()
    resultado = aplicar_regras(sugestoes.to_dict(orient="records"), engine)
    return resultado

@app.get("/os/reservadas")
def get_os_reservadas():
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT * FROM vw_os_reservadas
        """))
        return [dict(row) for row in result]

@app.get("/mapa/congestionamento")
def get_mapa_congestionamento():
    import json
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT * FROM vw_mapa_congestionamento
        """))
        rows = []
        for row in result:
            r = dict(row._mapping)
            # operadores vem como string JSON do PostgreSQL, é necessário converter de volta para lista
            if isinstance(r["operadores"], str):
                r["operadores"] = json.loads(r["operadores"])
            rows.append(r)
        return rows

@app.get("/mapa/dimensoes")
def get_dimensoes():
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT 
                deposito_id,
                MAX(rua) AS max_rua,
                MAX(predio) AS max_predio
            FROM enderecos
            GROUP BY deposito_id
        """))

        dados = []

        for row in result:
            dados.append({
                "deposito_id": row.deposito_id,
                "ruas": list(range(1, row.max_rua + 1)),
                "predios": list(range(1, row.max_predio + 1))
            })

        return dados

@app.get("/regras")
def get_regras():
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT r.*, op.nome AS operador_nome
            FROM regras_atribuicao r
            LEFT JOIN operadores op ON op.id = r.operador_id
            ORDER BY r.prioridade DESC, r.criado_em DESC
        """))
        return [dict(row._mapping) for row in result]


@app.get("/regras/presets")
def get_presets():
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT * FROM regras_presets ORDER BY nome
        """))
        return [dict(row._mapping) for row in result]


class RegraRequest(BaseModel):
    nome: str
    ativo: bool = True
    prioridade: int = 0
    modo: str
    operador_id: int | None = None
    condicoes: dict


@app.post("/regras")
def criar_regra(req: RegraRequest):
    import json
    with engine.begin() as conn:
        result = conn.execute(text("""
            INSERT INTO regras_atribuicao
              (nome, ativo, prioridade, modo, operador_id, condicoes)
            VALUES
              (:nome, :ativo, :prioridade, :modo, :operador_id, :condicoes)
            RETURNING id
        """), {
            "nome":        req.nome,
            "ativo":       req.ativo,
            "prioridade":  req.prioridade,
            "modo":        req.modo,
            "operador_id": req.operador_id,
            "condicoes":   json.dumps(req.condicoes)
        })
        return {"sucesso": True, "id": result.fetchone()[0]}


@app.patch("/regras/{regra_id}/ativo")
def toggle_regra(regra_id: int, ativo: bool):
    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE regras_atribuicao
            SET ativo = :ativo, atualizado_em = NOW()
            WHERE id = :id
        """), {"ativo": ativo, "id": regra_id})
    return {"sucesso": True}


@app.delete("/regras/{regra_id}")
def deletar_regra(regra_id: int):
    with engine.begin() as conn:
        conn.execute(text("""
            DELETE FROM regras_atribuicao WHERE id = :id
        """), {"id": regra_id})
    return {"sucesso": True}

@app.post("/os/reservar")
def reservar_os(req: ReservaRequest):
    with engine.begin() as conn:
        reserva = conn.execute(text("""
            SELECT id FROM os_reservas
            WHERE os_id = :os_id AND ativo = TRUE
        """), {"os_id": req.os_id}).fetchone()

        if reserva:
            return {"sucesso": False, "motivo": "OS já reservada"}
        
        conn.execute(text("""
            INSERT INTO os_reservas (os_id, operador_id, reservado_por)
            VALUES (:os_id, :operador_id, :reservado_por)
        """), {"os_id": req.os_id, "operador_id": req.operador_id, "reservado_por": req.reservado_por})
    return {"sucesso": True}


@app.get("/os/{os_id}/itens")
def get_itens_os(os_id: int):
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT
                oi.id,
                p.nome          AS produto,
                p.codigo        AS codigo_produto,
                ed.rua,
                ed.predio,
                ed.nivel,
                ed.apartamento,
                oi.qt_total,
                oi.qt_finalizada,
                oi.qt_cortada,
                oi.qt_cancelada,
                oi.dt_finalizacao,
                oi.dt_corte,
                oi.dt_cancelamento
            FROM os_itens oi
            JOIN produtos p   ON p.id  = oi.produto_id
            JOIN enderecos ed ON ed.id = oi.endereco_id
            WHERE oi.os_id = :os_id
            ORDER BY ed.rua, ed.predio, ed.nivel, ed.apartamento
        """), {"os_id": os_id})
        return [row._mapping for row in result]

@app.get("/os/{os_id}/rota_otimizada")
def get_rota_otimizada(os_id: int):
    import json
    from score import buscar_baseline, buscar_operadores_ativos

    # Busca itens da OS
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT
                ed.rua,
                ed.predio,
                ed.nivel,
                ed.apartamento,
                oi.id          AS item_id,
                p.nome         AS produto,
                p.codigo       AS codigo_produto,
                oi.qt_total,
                oi.qt_finalizada,
                oi.dt_finalizacao,
                oi.dt_corte,
                oi.dt_cancelamento
            FROM os_itens oi
            JOIN enderecos ed ON ed.id = oi.endereco_id
            JOIN produtos p   ON p.id  = oi.produto_id
            WHERE oi.os_id = :os_id
              AND oi.dt_finalizacao  IS NULL
              AND oi.dt_cancelamento IS NULL
              AND oi.dt_corte        IS NULL
            ORDER BY ed.rua, ed.predio, ed.nivel, ed.apartamento
        """), {"os_id": os_id})
        itens = [dict(row._mapping) for row in result]

    if not itens:
        return {"rota": [], "total_itens": 0, "itens_reordenados": 0,
                "zonas_congestionadas": [], "reordenacao_sugerida": False}

    # Busca operadores ativos e baseline
    operadores_ativos = buscar_operadores_ativos().to_dict(orient="records")
    baseline          = buscar_baseline()

    return otimizar_rota(itens, operadores_ativos, baseline)

@app.get("/operadores/disponiveis")
def get_operadores():
    operadores = buscar_operadores()
    return operadores[[
        "id", "nome", "deposito_id",
        "rua_media", "predio_media"
    ]].to_dict(orient="records")


@app.get("/operadores/status")
def get_operadores_status():
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT
                op.id AS operador_id,
                op.nome,
                op.ativo,
                CASE
                    WHEN op.ativo = FALSE THEN 'deslogado'
                    WHEN ea.operador_id IS NOT NULL THEN 'em_andamento'
                    ELSE 'disponivel'
                END AS status_operador,
                ea.os_id AS os_ativa
            FROM operadores op
            LEFT JOIN (
                SELECT DISTINCT ON (operador_id)
                    operador_id,
                    os_id
                FROM execucoes
                WHERE status = 'ativa'
                ORDER BY operador_id, inicio DESC
            ) ea ON ea.operador_id = op.id
            ORDER BY op.nome
        """))
        return [dict(row._mapping) for row in result]


@app.delete("/reservar/{os_id}")
def cancelar_reserva(os_id: int):
    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE os_reservas SET ativo = FALSE
            WHERE os_id = :os_id AND ativo = TRUE
        """), {"os_id": os_id})
    return {"sucesso": True}


@app.post("/atribuir")
def atribuir_os(req: AtribuicaoRequest):
    with engine.begin() as conn:
        # Conta itens pendentes da OS
        itens = conn.execute(text("""
            SELECT COUNT(*) FROM os_itens
            WHERE os_id = :os_id
              AND dt_finalizacao IS NULL
              AND dt_cancelamento IS NULL
              AND dt_corte IS NULL
        """), {"os_id": req.os_id}).scalar()

        # Insere execução
        conn.execute(text("""
            INSERT INTO execucoes
              (os_id, operador_id, status, inicio, itens_pendentes_inicio)
            VALUES
              (:os_id, :operador_id, 'ativa', NOW(), :itens)
        """), {"os_id": req.os_id, "operador_id": req.operador_id, "itens": itens})

        # Atualiza status da OS
        conn.execute(text("""
            UPDATE os SET status = 'em_andamento'
            WHERE id = :os_id
        """), {"os_id": req.os_id})

    return {"sucesso": True, "os_id": req.os_id, "operador_id": req.operador_id}

# DASHBOARD

@app.get("/dashboard/resumo")
def get_dashboard_resumo(
    dias:        Optional[int] = Query(90),
    deposito_id: Optional[int] = Query(None),
    tipo_os:     Optional[str] = Query(None)
):
    with engine.begin() as conn:
        params  = {}
        filtros = ["ex.status = 'finalizada'"]

        if dias:
            filtros.append(f"ex.inicio >= NOW() - INTERVAL '{dias} days'")
        if deposito_id:
            filtros.append("ed.deposito_id = :deposito_id")
            params["deposito_id"] = deposito_id
        if tipo_os:
            filtros.append("ot.codigo = :tipo_os")
            params["tipo_os"] = tipo_os

        filtros.append("ex.tempo_segundos BETWEEN 60 AND 7200")
        where = " AND ".join(filtros)

        result = conn.execute(text(f"""
            SELECT
                COUNT(DISTINCT ex.id)                   AS total_execucoes,
                COUNT(DISTINCT ex.operador_id)           AS total_operadores,
                ROUND(AVG(ex.tempo_segundos) / 60.0, 1) AS tempo_medio_min,
                ROUND(MIN(ex.tempo_segundos) / 60.0, 1) AS tempo_min_min,
                ROUND(MAX(ex.tempo_segundos) / 60.0, 1) AS tempo_max_min,
                COUNT(DISTINCT ex.os_id)                 AS os_executadas
            FROM execucoes ex
            JOIN os o         ON o.id       = ex.os_id
            JOIN os_tipos ot  ON ot.codigo  = o.tipo_codigo
            JOIN os_itens oi  ON oi.os_id   = ex.os_id
            JOIN enderecos ed ON ed.id      = oi.endereco_id
            WHERE {where}
        """), params)

        return dict(result.fetchone()._mapping)


@app.get("/dashboard/produtividade")
def get_dashboard_produtividade(
    dias:        Optional[int] = Query(90),
    deposito_id: Optional[int] = Query(None),
    tipo_os:     Optional[str] = Query(None)
):
    with engine.begin() as conn:
        params  = {}
        filtros = ["ex.status = 'finalizada'"]

        if dias:
            filtros.append(f"ex.inicio >= NOW() - INTERVAL '{dias} days'")
        if deposito_id:
            filtros.append("ed.deposito_id = :deposito_id")
            params["deposito_id"] = deposito_id
        if tipo_os:
            filtros.append("ot.codigo = :tipo_os")
            params["tipo_os"] = tipo_os

        filtros.append("ex.tempo_segundos BETWEEN 60 AND 7200")
        where = " AND ".join(filtros)

        result = conn.execute(text(f"""
            SELECT
                op.id                                    AS operador_id,
                op.nome                                  AS operador,
                ot.descricao                             AS tipo_os,
                COUNT(ex.id)                             AS total_execucoes,
                ROUND(AVG(ex.tempo_segundos) / 60.0, 1) AS tempo_medio_min,
                ROUND(MIN(ex.tempo_segundos) / 60.0, 1) AS tempo_min_min,
                ROUND(MAX(ex.tempo_segundos) / 60.0, 1) AS tempo_max_min
            FROM execucoes ex
            JOIN operadores op ON op.id       = ex.operador_id
            JOIN os o          ON o.id        = ex.os_id
            JOIN os_tipos ot   ON ot.codigo   = o.tipo_codigo
            JOIN os_itens oi   ON oi.os_id    = ex.os_id
            JOIN enderecos ed  ON ed.id       = oi.endereco_id
            WHERE {where}
            GROUP BY op.id, op.nome, ot.descricao
            ORDER BY tempo_medio_min ASC
        """), params)

        return [dict(row._mapping) for row in result]


@app.get("/dashboard/volume")
def get_dashboard_volume(
    dias:        Optional[int] = Query(90),
    deposito_id: Optional[int] = Query(None),
    tipo_os:     Optional[str] = Query(None)
):
    with engine.begin() as conn:
        params  = {}
        filtros = ["ex.status = 'finalizada'"]

        if dias:
            filtros.append(f"ex.inicio >= NOW() - INTERVAL '{dias} days'")
        if deposito_id:
            filtros.append("ed.deposito_id = :deposito_id")
            params["deposito_id"] = deposito_id
        if tipo_os:
            filtros.append("ot.codigo = :tipo_os")
            params["tipo_os"] = tipo_os

        where = " AND ".join(filtros)

        result = conn.execute(text(f"""
            SELECT
                DATE(ex.inicio)  AS data,
                ot.descricao     AS tipo_os,
                COUNT(ex.id)     AS total
            FROM execucoes ex
            JOIN os o        ON o.id      = ex.os_id
            JOIN os_tipos ot ON ot.codigo = o.tipo_codigo
            JOIN os_itens oi ON oi.os_id  = ex.os_id
            JOIN enderecos ed ON ed.id    = oi.endereco_id
            WHERE {where}
            GROUP BY DATE(ex.inicio), ot.descricao
            ORDER BY data ASC
        """), params)

        return [dict(row._mapping) for row in result]


@app.get("/dashboard/congestionamento")
def get_dashboard_congestionamento(
    dias:        Optional[int] = Query(90),
    deposito_id: Optional[int] = Query(None)
):
    with engine.begin() as conn:
        params  = {}
        filtros = ["ex.status = 'finalizada'"]

        if dias:
            filtros.append(f"ex.inicio >= NOW() - INTERVAL '{dias} days'")
        if deposito_id:
            filtros.append("ed.deposito_id = :deposito_id")
            params["deposito_id"] = deposito_id

        where = " AND ".join(filtros)

        result = conn.execute(text(f"""
            SELECT
                EXTRACT(HOUR FROM ex.inicio)::INT AS hora,
                EXTRACT(DOW  FROM ex.inicio)::INT AS dia_semana,
                COUNT(ex.id)                       AS total_execucoes,
                ROUND(AVG(ex.tempo_segundos) / 60.0, 1) AS tempo_medio_min
            FROM execucoes ex
            JOIN os_itens oi  ON oi.os_id = ex.os_id
            JOIN enderecos ed ON ed.id    = oi.endereco_id
            WHERE {where}
            GROUP BY hora, dia_semana
            ORDER BY dia_semana, hora
        """), params)

        return [dict(row._mapping) for row in result]


@app.get("/dashboard/tipos_os")
def get_dashboard_tipos_os():
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT codigo, descricao FROM os_tipos ORDER BY descricao
        """))
        return [dict(row._mapping) for row in result]