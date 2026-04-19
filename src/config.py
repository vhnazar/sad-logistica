# src/config.py
# Configurações de constantes para o armazém
# Ajustes de valores de acordo com o layout

WAREHOUSE_LAYOUT = {
    # Dimensões físicas do armazém (metros)
    "largura_predio_m":     2.3,  # Largura de cada prédio
    "largura_apto_m":       0.46, # Largura de cada apto
    "largura_corredor_m":   2.5,  # Largura do corredor entre prédios

    "velocidade_ms": 1.3,         # Velocidade média de locomoção do operador (m/s)

    "custo_nivel_seg": 30,        # Custo de mudança de nível (segundos) - Empilhadeira

    "predios_por_rua": 5,         # Número de prédios por rua    
}