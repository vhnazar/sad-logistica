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
    return sugestoes.to_dict(orient="records")


@app.get("/os/reservadas")
def get_os_reservadas():
    with engine.begin() as conn:
        result = conn.execute(text("""
            SELECT * FROM vw_os_reservadas
        """))
        return [dict(row) for row in result]


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


@app.get("/operadores/disponiveis")
def get_operadores():
    operadores = buscar_operadores()
    return operadores[[
        "id", "nome", "deposito_id",
        "rua_media", "predio_media"
    ]].to_dict(orient="records")


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