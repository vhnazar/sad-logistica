# Algoritmo de otimização de rota de coleta dentro de uma OS
# Respeita padrão serpentina e sugere reordenação em zonas congestionadas
    
import pandas as pd
from config import WAREHOUSE_LAYOUT, REORDENACAO

def ordenar_serpentina(itens: list[dict]) -> list[dict]:
    """
    Ordena itens pelo padrão serpentina do armazém.
    Ruas ímpares: prédio crescente (P1 -> P5)
    Ruas pares:   prédio decrescente (P5 -> P1)
    Dentro do prédio: nível crescente, apartamento crescente.
    """
    def chave_serpentina(item):
        rua    = item["rua"]
        predio = item["predio"] if rua % 2 != 0 else -item["predio"]
        return (rua, predio, item["nivel"], item["apartamento"])

    return sorted(itens, key=chave_serpentina)


def calcular_atraso_zona(rua: int, predio: int, operadores_ativos: list[dict],
                          baseline: pd.DataFrame) -> float:
    """
    Calcula o atraso estimado em segundos para uma zona (rua+prédio)
    baseado nos operadores ativos naquela zona.
    Mesma lógica do custo_congestao do motor de score.
    """
    atraso_total = 0

    for op in operadores_ativos:
        if round(op.get("rua_media", 0)) != rua:
            continue
        if round(op.get("predio_media", 0)) != predio:
            continue

        tempo_decorrido = (
            pd.Timestamp.now() - pd.Timestamp(op["inicio"])
        ).total_seconds()

        hist = baseline[baseline["matricula"] == op["operador_id"]]
        tempo_medio = hist["tempo_medio"].mean() if not hist.empty else baseline["tempo_medio"].mean()

        tempo_restante = max(0, tempo_medio - tempo_decorrido)
        atraso_total += tempo_restante

    return atraso_total

def calcular_tempo_entre_itens(item_a: dict, item_b: dict) -> float:
    """
    Calcula tempo estimado de deslocamento entre dois itens consecutivos
    usando as dimensões físicas do armazém (config.py).
    Segue o padrão serpentina, não recalcula rota, só estima tempo direto.
    """
    CUSTO_APTO     = WAREHOUSE_LAYOUT["largura_apto_m"]     / WAREHOUSE_LAYOUT["velocidade_ms"]
    CUSTO_PREDIO   = WAREHOUSE_LAYOUT["largura_predio_m"]   / WAREHOUSE_LAYOUT["velocidade_ms"]
    CUSTO_CORREDOR = WAREHOUSE_LAYOUT["largura_corredor_m"] / WAREHOUSE_LAYOUT["velocidade_ms"]
    CUSTO_NIVEL    = WAREHOUSE_LAYOUT["custo_nivel_seg"]

    custo = 0

    # Deslocamento de apartamento
    custo += abs(item_a["apartamento"] - item_b["apartamento"]) * CUSTO_APTO

    # Deslocamento de nível
    custo += abs(item_a["nivel"] - item_b["nivel"]) * CUSTO_NIVEL

    if item_a["rua"] == item_b["rua"]:
        # Mesma rua - só deslocamento de prédio
        custo += abs(item_a["predio"] - item_b["predio"]) * CUSTO_PREDIO
    else:
        # Ruas diferentes - percorre até o fim da rua atual + corredor + prédios na rua destino
        predios_por_rua = WAREHOUSE_LAYOUT["predios_por_rua"]
        ruas_entre = abs(item_a["rua"] - item_b["rua"])

        custo += abs(item_a["predio"] - predios_por_rua) * CUSTO_PREDIO
        custo += ruas_entre * CUSTO_CORREDOR
        custo += abs(1 - item_b["predio"]) * CUSTO_PREDIO

    return round(custo, 1)

def otimizar_rota(itens: list[dict], operadores_ativos: list[dict],
                   baseline: pd.DataFrame) -> dict:
    """
    Retorna a rota otimizada de coleta para uma OS.

    Lógica:
    1. Ordena por serpentina
    2. Verifica congestionamento por rua
    3. Ruas congestionadas (threshold atingido) vão para o final
    4. Retorna itens ordenados com flags de congestionamento e atraso estimado

    Parâmetros configuráveis em config.py:
    - REORDENACAO["threshold_operadores"]
    - REORDENACAO["threshold_atraso_seg"]
    """
    threshold_ops    = REORDENACAO["threshold_operadores"]
    threshold_atraso = REORDENACAO["threshold_atraso_seg"]

    # 1. Ordena por serpentina
    itens_ordenados = ordenar_serpentina(itens)

    # 2. Identifica ruas congestionadas
    ruas_analisadas = {}
    for item in itens_ordenados:
        chave = (item["rua"], item["predio"])
        if chave in ruas_analisadas:
            continue

        # Conta operadores ativos nessa zona
        ops_na_zona = [
            op for op in operadores_ativos
            if round(op.get("rua_media", 0)) == item["rua"]
            and round(op.get("predio_media", 0)) == item["predio"]
        ]
        total_ops = len(ops_na_zona)

        # Calcula atraso estimado
        atraso = calcular_atraso_zona(
            item["rua"], item["predio"], operadores_ativos, baseline
        )

        # Zona é congestionada se atende ambos os critérios
        congestionada = total_ops >= threshold_ops and atraso >= threshold_atraso

        ruas_analisadas[chave] = {
            "congestionada":  congestionada,
            "total_operadores": total_ops,
            "atraso_seg":     round(atraso),
            "atraso_min":     round(atraso / 60, 1)
        }

    # 3. Separa itens normais e congestionados
    itens_normais       = []
    itens_congestionados = []

    for item in itens_ordenados:
        chave  = (item["rua"], item["predio"])
        info   = ruas_analisadas[chave]
        item_c = {
            **item,
            "congestionado":    info["congestionada"],
            "total_operadores": info["total_operadores"],
            "atraso_seg":       info["atraso_seg"],
            "atraso_min":       info["atraso_min"]
        }

        if info["congestionada"]:
            itens_congestionados.append(item_c)
        else:
            itens_normais.append(item_c)

    # 4. Monta rota final, congestionados vão para o final
    rota_final = itens_normais + itens_congestionados

    # 5. Monta resumo para o gestor
    zonas_congestionadas = [
        {
            "rua":              k[0],
            "predio":           k[1],
            "total_operadores": v["total_operadores"],
            "atraso_min":       v["atraso_min"]
        }
        for k, v in ruas_analisadas.items()
        if v["congestionada"]
    ]

    # 6. Calcula tempo estimado de deslocamento entre itens consecutivos
    tempo_total_seg = 0
    for i, item in enumerate(rota_final):
        if i == 0:
            item["tempo_deslocamento_seg"] = 0
        else:
            t = calcular_tempo_entre_itens(rota_final[i-1], rota_final[i])
            item["tempo_deslocamento_seg"] = t
            tempo_total_seg += t

    return {
        "rota":                 rota_final,
        "total_itens":          len(rota_final),
        "itens_reordenados":    len(itens_congestionados),
        "zonas_congestionadas": zonas_congestionadas,
        "reordenacao_sugerida": len(itens_congestionados) > 0,
        "tempo_total_deslocamento_seg": round(tempo_total_seg),
        "tempo_total_deslocamento_min": round(tempo_total_seg / 60, 1)
    }