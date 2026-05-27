from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
import sys
import os
from dotenv import load_dotenv
from urllib.parse import quote_plus
from sqlalchemy import create_engine, text
import pandas as pd

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