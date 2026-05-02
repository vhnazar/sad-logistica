# Motor de avaliação de regras de atribuição automática

from sqlalchemy import text


def avaliar_condicoes(condicoes: dict, os_data: dict) -> bool:
    """
    Avalia se uma OS atende as condições de uma regra.
    
    condicoes: dict com chaves 'all' e/ou 'any'
    os_data: dict com dados da OS (score, tipo_os, etc)
    """
    resultado_all = True
    resultado_any = True

    if 'all' in condicoes:
        resultado_all = all(
            avaliar_condicao(c, os_data) for c in condicoes['all']
        )

    if 'any' in condicoes:
        resultado_any = any(
            avaliar_condicao(c, os_data) for c in condicoes['any']
        )

    # Se tem os dois, ambos precisam ser verdadeiros
    if 'all' in condicoes and 'any' in condicoes:
        return resultado_all and resultado_any
    if 'all' in condicoes:
        return resultado_all
    if 'any' in condicoes:
        return resultado_any

    return False


def avaliar_condicao(condicao: dict, os_data: dict) -> bool:
    """
    Avalia uma condição individual.
    
    condicao: {'campo': 'score', 'op': '<', 'valor': 800}
    """
    campo = condicao.get('campo')
    op    = condicao.get('op')
    valor = condicao.get('valor')

    # Busca o valor do campo na OS
    valor_os = os_data.get(campo)
    if valor_os is None:
        return False

    try:
        if op == '<':  return float(valor_os) <  float(valor)
        if op == '>':  return float(valor_os) >  float(valor)
        if op == '<=': return float(valor_os) <= float(valor)
        if op == '>=': return float(valor_os) >= float(valor)
        if op == '=':  return str(valor_os)   == str(valor)
        if op == '!=': return str(valor_os)   != str(valor)
    except (ValueError, TypeError):
        return False

    return False


def aplicar_regras(os_sugestoes: list, engine) -> list:
    """
    Percorre as regras ativas por prioridade e aplica nas OS sugeridas.
    Retorna a lista com campo 'regra_aplicada' preenchido quando houver match.
    """
    with engine.connect() as conn:
        regras = conn.execute(text("""
            SELECT id, nome, modo, operador_id, condicoes
            FROM regras_atribuicao
            WHERE ativo = TRUE
            ORDER BY prioridade DESC
        """)).fetchall()

    resultado = []

    for os_data in os_sugestoes:
        os_dict = dict(os_data)
        os_dict['regra_aplicada'] = None
        os_dict['operador_regra'] = None

        for regra in regras:
            condicoes = regra.condicoes
            if isinstance(condicoes, str):
                import json
                condicoes = json.loads(condicoes)

            if avaliar_condicoes(condicoes, os_dict):
                os_dict['regra_aplicada'] = regra.nome

                if regra.modo == 'fixo' and regra.operador_id:
                    os_dict['operador_regra'] = regra.operador_id
                # modo automático mantém o operador sugerido pelo motor de score

                break  # primeira regra que bate ganha (ordem de prioridade)

        resultado.append(os_dict)

    return resultado