"""
SAD - Sistema de Apoio à Decisão para Logística Interna
Geração de Dados Sintéticos

Como usar:
  1. Configure as variáveis de ambiente:
     Windows:   set DB_PASSWORD=sua_senha
     Linux/Mac: export DB_PASSWORD=sua_senha
  2. Execute: python gerar_dados.py

Dados gerados:
  - 50 operadores
  - 200 produtos com dados logísticos (25% provisórios)
  - ~860 endereços distribuídos nos 2 depósitos
  - Estoque distribuído pelos endereços
  - 600 OS com itens
  - Execuções com timestamps realistas
  - ~10% de reatribuições
  - ~3% de dados sujos propositais (tempos absurdos)
"""

import os
import psycopg as psycopg2
import random
from faker import Faker
from datetime import datetime, timedelta

# =============================================================
# CONFIGURAÇÃO DE CONEXÃO
# =============================================================
CONN_STRING = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5433')} "
    f"dbname={os.getenv('DB_NAME', 'sad_logistica')} "
    f"user={os.getenv('DB_USER', 'postgres')} "
    f"password={os.getenv('DB_PASSWORD')}"
)

fake = Faker("pt_BR")
random.seed(42)  # garante reprodutibilidade

# =============================================================
# CONEXÃO
# =============================================================
print("Conectando ao banco...")
conn = psycopg2.connect(CONN_STRING)
cur = conn.cursor()
print("Conectado.\n")


# =============================================================
# 1. OPERADORES (50)
# =============================================================
print("Inserindo operadores...")

operadores_ids = []
for _ in range(50):
    nome = fake.name()
    cur.execute(
        "INSERT INTO operadores (nome, ativo) VALUES (%s, %s) RETURNING id",
        (nome, True)
    )
    operadores_ids.append(cur.fetchone()[0])

conn.commit()
print(f"  {len(operadores_ids)} operadores inseridos.")


# =============================================================
# 2. PRODUTOS (200)
# 25% com dado_provisorio=TRUE (valor padrão 0.2)
# =============================================================
print("Inserindo produtos...")

categorias = ["Eletronico", "Alimento", "Limpeza", "Vestuario", "Ferramenta"]
produtos_ids = []

for i in range(1, 201):
    codigo = f"PROD-{i:04d}"
    nome = f"{random.choice(categorias)} {fake.word().capitalize()}"
    provisorio = random.random() < 0.25

    if provisorio:
        peso_bruto = peso_liq = alt = larg = comp = 0.2
    else:
        peso_bruto = round(random.uniform(0.1, 50.0), 3)
        peso_liq   = round(peso_bruto * random.uniform(0.7, 0.99), 3)
        alt        = round(random.uniform(5.0, 120.0), 2)
        larg       = round(random.uniform(5.0, 80.0), 2)
        comp       = round(random.uniform(5.0, 100.0), 2)

    cur.execute("""
        INSERT INTO produtos
          (codigo, nome, peso_bruto_kg, peso_liquido_kg,
           altura_cm, largura_cm, comprimento_cm, dado_provisorio)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
    """, (codigo, nome, peso_bruto, peso_liq, alt, larg, comp, provisorio))
    produtos_ids.append(cur.fetchone()[0])

conn.commit()
print(f"  {len(produtos_ids)} produtos inseridos.")


# =============================================================
# 3. ENDEREÇOS
# Depósito 1 (solo):    ruas 1-10, prédios 1-5, níveis 1-2, aptos 1-5
# Depósito 2 (elevado): ruas 1-6,  prédios 1-4, níveis 1-5, aptos 1-3
# =============================================================
print("Inserindo endereços...")

enderecos_dep1 = []
enderecos_dep2 = []

for rua in range(1, 11):
    for predio in range(1, 6):
        for nivel in range(1, 3):
            for apto in range(1, 6):
                cur.execute("""
                    INSERT INTO enderecos
                      (deposito_id, rua, predio, nivel, apartamento)
                    VALUES (1, %s, %s, %s, %s)
                    RETURNING id
                """, (rua, predio, nivel, apto))
                enderecos_dep1.append(cur.fetchone()[0])

for rua in range(1, 7):
    for predio in range(1, 5):
        for nivel in range(1, 6):
            for apto in range(1, 4):
                cur.execute("""
                    INSERT INTO enderecos
                      (deposito_id, rua, predio, nivel, apartamento)
                    VALUES (2, %s, %s, %s, %s)
                    RETURNING id
                """, (rua, predio, nivel, apto))
                enderecos_dep2.append(cur.fetchone()[0])

conn.commit()
print(f"  {len(enderecos_dep1)} endereços no depósito 1 (solo).")
print(f"  {len(enderecos_dep2)} endereços no depósito 2 (elevado).")


# =============================================================
# 4. ESTOQUE
# Cada produto em 1 a 3 endereços aleatórios
# =============================================================
print("Inserindo estoque...")

todos_enderecos = enderecos_dep1 + enderecos_dep2
pares_inseridos = set()
count_estoque = 0

for produto_id in produtos_ids:
    qtd_locais = random.randint(1, 3)
    enderecos_escolhidos = random.sample(todos_enderecos, qtd_locais)

    for end_id in enderecos_escolhidos:
        par = (produto_id, end_id)
        if par not in pares_inseridos:
            quantidade = random.randint(10, 500)
            cur.execute("""
                INSERT INTO estoque (produto_id, endereco_id, quantidade)
                VALUES (%s, %s, %s)
            """, (produto_id, end_id, quantidade))
            pares_inseridos.add(par)
            count_estoque += 1

conn.commit()
print(f"  {count_estoque} registros de estoque inseridos.")


# =============================================================
# 5. OS + ITENS + EXECUÇÕES (600 OS)
#
# Perfis de tempo por tipo (segundos):
#   1   = Separação Carrinho    → solo    → 5 a 20 min
#   9   = Separação Paletizado  → solo    → 15 a 45 min
#   23  = Empilhadeira          → elevado → 20 a 60 min
#   88  = Armazenagem           → ambos   → 10 a 35 min
#   99  = Devolução             → ambos   → 5 a 15 min
#   123 = Recebimento           → ambos   → 30 a 90 min
# =============================================================
print("Inserindo OS, itens e execuções...")

TIPOS_OS = {
    1:   {"deposito": "solo",    "tempo_min": 300,  "tempo_max": 1200, "itens": (2, 8)},
    9:   {"deposito": "solo",    "tempo_min": 900,  "tempo_max": 2700, "itens": (3, 12)},
    23:  {"deposito": "elevado", "tempo_min": 1200, "tempo_max": 3600, "itens": (1, 5)},
    88:  {"deposito": "ambos",   "tempo_min": 600,  "tempo_max": 2100, "itens": (2, 10)},
    99:  {"deposito": "ambos",   "tempo_min": 300,  "tempo_max": 900,  "itens": (1, 4)},
    123: {"deposito": "ambos",   "tempo_min": 1800, "tempo_max": 5400, "itens": (5, 20)},
}

ops_solo    = operadores_ids[:35]
ops_elevado = operadores_ids[35:]

data_base = datetime.now() - timedelta(days=90)

os_count   = 0
exec_count = 0

for i in range(600):
    tipo_codigo = random.choices(
        list(TIPOS_OS.keys()),
        weights=[35, 25, 15, 15, 5, 5],
        k=1
    )[0]
    perfil = TIPOS_OS[tipo_codigo]

    if perfil["deposito"] == "solo":
        ops_pool  = ops_solo
        ends_pool = enderecos_dep1
    elif perfil["deposito"] == "elevado":
        ops_pool  = ops_elevado
        ends_pool = enderecos_dep2
    else:
        ops_pool  = operadores_ids
        ends_pool = todos_enderecos

    criado_em = data_base + timedelta(
        days=random.randint(0, 89),
        hours=random.randint(6, 17),
        minutes=random.randint(0, 59)
    )

    cur.execute("""
        INSERT INTO os (tipo_codigo, status, criado_em, finalizado_em)
        VALUES (%s, 'finalizada', %s, %s)
        RETURNING id
    """, (tipo_codigo, criado_em, criado_em + timedelta(hours=1)))
    os_id = cur.fetchone()[0]
    os_count += 1

    # Itens da OS
    qtd_itens = random.randint(*perfil["itens"])
    prods_escolhidos = random.sample(produtos_ids, min(qtd_itens, len(produtos_ids)))
    ends_escolhidos  = random.sample(ends_pool, min(qtd_itens, len(ends_pool)))

    for prod_id, end_id in zip(prods_escolhidos, ends_escolhidos):
        qt_total = random.randint(1, 20)
        sorte    = random.random()

        if sorte < 0.75:
            # Coleta completa
            qt_fin, qt_cort, qt_canc = qt_total, 0, 0
            dt_fin  = criado_em + timedelta(minutes=random.randint(5, 50))
            dt_cort = dt_canc = None

        elif sorte < 0.88:
            # Corte parcial — só possível se qt_total > 1
            if qt_total == 1:
                qt_fin, qt_cort, qt_canc = qt_total, 0, 0
                dt_fin  = criado_em + timedelta(minutes=random.randint(5, 50))
                dt_cort = dt_canc = None
            else:
                qt_fin  = random.randint(1, qt_total - 1)
                qt_cort = qt_total - qt_fin
                qt_canc = 0
                dt_fin  = criado_em + timedelta(minutes=random.randint(5, 50))
                dt_cort = dt_fin + timedelta(minutes=random.randint(1, 10))
                dt_canc = None

        elif sorte < 0.94:
            # Corte total
            qt_fin, qt_cort, qt_canc = 0, qt_total, 0
            dt_fin  = None
            dt_cort = criado_em + timedelta(minutes=random.randint(5, 30))
            dt_canc = None

        else:
            # Cancelamento
            qt_fin, qt_cort, qt_canc = 0, 0, qt_total
            dt_fin  = None
            dt_cort = None
            dt_canc = criado_em + timedelta(minutes=random.randint(1, 10))

        cur.execute("""
            INSERT INTO os_itens
              (os_id, produto_id, endereco_id,
               qt_total, qt_finalizada, qt_cortada, qt_cancelada,
               dt_finalizacao, dt_corte, dt_cancelamento)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (os_id, prod_id, end_id,
              qt_total, qt_fin, qt_cort, qt_canc,
              dt_fin, dt_cort, dt_canc))

    # Execução
    operador_id   = random.choice(ops_pool)
    inicio_exec   = criado_em + timedelta(minutes=random.randint(1, 5))
    houve_reatrib = random.random() < 0.10

    if houve_reatrib:
        # Primeira execução cancelada
        tempo_parcial = random.randint(60, max(61, perfil["tempo_min"] - 60))
        fim_parcial   = inicio_exec + timedelta(seconds=tempo_parcial)

        cur.execute("""
            INSERT INTO execucoes
              (os_id, operador_id, status, inicio, fim,
               tempo_segundos, itens_pendentes_inicio, itens_finalizados)
            VALUES (%s, %s, 'cancelada', %s, %s, %s, %s, %s)
        """, (os_id, operador_id, inicio_exec, fim_parcial,
              tempo_parcial, qtd_itens, random.randint(0, qtd_itens // 2)))

        # Segunda execução com operador diferente
        outros_ops   = [o for o in ops_pool if o != operador_id]
        segundo_op   = random.choice(outros_ops) if outros_ops else operador_id
        inicio_exec2 = fim_parcial + timedelta(minutes=random.randint(1, 5))
        tempo2       = random.randint(perfil["tempo_min"], perfil["tempo_max"])
        fim2         = inicio_exec2 + timedelta(seconds=tempo2)
        itens_rest   = random.randint(qtd_itens // 2, qtd_itens)

        cur.execute("""
            INSERT INTO execucoes
              (os_id, operador_id, status, inicio, fim,
               tempo_segundos, itens_pendentes_inicio, itens_finalizados)
            VALUES (%s, %s, 'finalizada', %s, %s, %s, %s, %s)
        """, (os_id, segundo_op, inicio_exec2, fim2,
              tempo2, itens_rest, itens_rest))
        exec_count += 2

    else:
        # Execução normal
        tempo_seg = random.randint(perfil["tempo_min"], perfil["tempo_max"])

        # Dado sujo proposital: ~3% com tempo absurdo
        if random.random() < 0.03:
            tempo_seg = random.choice([5, 10, 99999, 0])

        fim_exec = inicio_exec + timedelta(seconds=tempo_seg)

        cur.execute("""
            INSERT INTO execucoes
              (os_id, operador_id, status, inicio, fim,
               tempo_segundos, itens_pendentes_inicio, itens_finalizados)
            VALUES (%s, %s, 'finalizada', %s, %s, %s, %s, %s)
        """, (os_id, operador_id, inicio_exec, fim_exec,
              tempo_seg, qtd_itens, qtd_itens))
        exec_count += 1

    if i % 100 == 0:
        conn.commit()
        print(f"  {i}/600 OS processadas...")

conn.commit()
print(f"\n  {os_count} OS inseridas.")
print(f"  {exec_count} execuções inseridas.")


# =============================================================
# RESUMO FINAL
# =============================================================
print("\n=== RESUMO FINAL ===")
tabelas = [
    "depositos", "operadores", "produtos", "enderecos",
    "estoque", "os", "os_itens", "execucoes"
]
for tabela in tabelas:
    cur.execute(f"SELECT COUNT(*) FROM {tabela}")
    total = cur.fetchone()[0]
    print(f"  {tabela:<15} → {total:>6} registros")

cur.close()
conn.close()
print("\nConcluído. Banco populado com sucesso!")
