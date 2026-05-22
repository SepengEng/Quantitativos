// Prompts especializados por disciplina
// Detectados automaticamente pelo prefixo do nome do arquivo

export const PREFIXOS_DISCIPLINA = {
  "ARQ": "Arquitetura",
  "EST": "Estrutura",
  "ELE": "Elétrica",
  "HID": "Hidrossanitária",
  "PLU": "Pluvial",
  "DRE": "Pluvial",
  "INC": "Incêndio",
  "SPK": "Incêndio",
  "HVA": "HVAC",
  "ACL": "HVAC",
  "CFT": "CFTV",
  "CAM": "CFTV",
  "VOZ": "Dados e Voz",
  "DAD": "Dados e Voz",
  "SPD": "SPDA",
  "GAS": "Gás Industrial",
  "TUB": "Gás Industrial",
  "MEC": "Mecânica",
};

export function detectarDisciplina(fileName) {
  if (!fileName) return null;
  const upper = fileName.toUpperCase();
  for (const [prefix, disc] of Object.entries(PREFIXOS_DISCIPLINA)) {
    if (upper.startsWith(prefix) || upper.includes(`-${prefix}-`) || upper.includes(`_${prefix}_`)) {
      return disc;
    }
  }
  return null;
}

const BASE_INSTRUCOES = `
REGRAS GERAIS:
- Meça APENAS pelos elementos visíveis no desenho (cotas, símbolos, hachuras)
- NÃO copie tabelas pré-preenchidas do documento
- Sugira o código SINAPI Bahia Não Desonerado mais preciso para cada item
- Fonte: "📐 Cota" | "🔢 Contagem" | "🧮 Cálculo" | "🔍 Inferência"

Retorne APENAS JSON:
{
  "disciplina": "...",
  "escala": "1:XX",
  "resumo": "descrição e principais dimensões extraídas",
  "itens": [{
    "codigo_item": "XXX-001",
    "descricao": "descrição técnica completa",
    "un": "m|m²|m³|un|kg",
    "qtd": 0.00,
    "fonte": "📐 Cota",
    "obs": "como foi medido especificamente",
    "sinapi_sugerido": "XXXXX",
    "sinapi_descricao": "descrição curta do SINAPI"
  }],
  "alertas": ["itens a confirmar em campo"]
}`;

export const PROMPTS = {

  "Arquitetura": `Especialista em arquitetura e projetos prediais brasileiros.

Extraia do desenho:
PAREDES: comprimento linear (m) e área (m²) de cada segmento — alvenaria e drywall separados. Use as cotas para somar cada trecho individualmente.
PISOS: área (m²) por ambiente e tipo (porcelanato, cerâmica, concreto, etc.)
ESQUADRIAS: tipo exato (PM1, P01, J01...), dimensões lidas nas cotas, contagem visual dos arcos/símbolos
REVESTIMENTOS: área de parede por tipo (cerâmica, pintura, reboco)
COBERTURA: área (m²) e tipo (laje, telha fibrocimento, telha metálica)
LOUÇAS: bacia, lavatório, cuba — contar símbolo por símbolo
HVAC arquitetônico: splits indicados na planta, localização

SINAPIs úteis: Alvenaria 9cm: 87451 | Alvenaria 14cm: 87452 | Bloco concreto: 89714
Drywall 48mm: 90762 | Drywall 73mm: 90763 | Porcelanato 60x60: 87893
Cerâmica parede: 87264 | Pintura látex: 87880 | Reboco: 87529
Porta madeira 0,80: 88511 | Janela correr 2,00x1,20: 88520
Split 18000: 88317 | Bacia: 86896 | Lavatório: 86897
Telha fibrocimento: 88500 | Impermeabilização manta: 88497
${BASE_INSTRUCOES}`,

  "Estrutura": `Especialista em estruturas de concreto armado e metálicas brasileiras.

Extraia do desenho:
PILARES: seção (cm²) e quantidade contada — um código por tipo de seção
VIGAS: comprimento linear por vão (m), seção
LAJES: área (m²) por tipo (maciça, nervurada, pré-moldada, steel deck)
CONCRETO: volume estimado (m³) = área × espessura lida nas cotas
FORMAS: área de forma (m²) = área estrutural × fator de forma
ARMAÇÃO: peso estimado (kg) = volume concreto × taxa kg/m³ (150 kg/m³ laje, 200 vigas, 250 pilares)
ESTRUTURA METÁLICA: peso estimado (kg) por perfil
FUNDAÇÕES: tipo, dimensões, quantidade

SINAPIs úteis: Concreto FCK20: 96527 | FCK25: 96528 | FCK30: 96529
Forma madeira: 94965 | Armação CA-50: 94966 | Armação CA-60: 94967
Laje pré-moldada: 98300 | Steel deck: 96530
Pilar concreto armado: 96540 | Viga concreto armado: 96541
Estrutura metálica galpão: 98210 | Coluna perfil I: 98211
Estaca raiz: 74004 | Bloco coroamento: 74005
${BASE_INSTRUCOES}`,

  "Elétrica": `Especialista em instalações elétricas prediais e industriais brasileiras (ABNT NBR 5410).

Extraia do desenho:
ELETRODUTOS: comprimento linear (m) por diâmetro e tipo (PVC rígido, metálico)
CABOS: comprimento (m) por seção em mm² — leia os circuitos no diagrama
TOMADAS/PONTOS: contar cada símbolo — tomada 2P+T, tomada 3F, etc.
ILUMINAÇÃO: contar luminárias por tipo (LED, fluorescente, emergência)
QUADROS: QD, QDL, QF — contar e identificar pelo diagrama
DISJUNTORES: contar por amperagem no diagrama unifilar
CABOS DE FORÇA: alimentadores principais em m
SUBESTAÇÃO: transformador, chave, para-raios (se indicado)
BANDEJAS/ELETROCALHAS: comprimento linear (m) por largura

SINAPIs úteis: Eletroduto PVC 25mm: 91911 | PVC 32mm: 91912 | PVC 50mm: 91913
Eletroduto metálico 1": 91914 | Bandeja 100x50: 91935 | Bandeja 200x50: 91936
Cabo 2,5mm²: 91925 | Cabo 4mm²: 91926 | Cabo 6mm²: 91927 | Cabo 10mm²: 91928
Cabo 16mm²: 91929 | Cabo 25mm²: 91930 | Cabo 35mm²: 91931
Tomada 20A: 91940 | Interruptor simples: 91941
Luminária LED 40W: 91945 | Luminária industrial 100W: 91946
QD distribuição: 91950 | Disjuntor bipolar 20A: 91951 | Disjuntor tripolar 40A: 91952
${BASE_INSTRUCOES}`,

  "Hidrossanitária": `Especialista em instalações hidrossanitárias prediais brasileiras (ABNT NBR 5626/8160).

Extraia do desenho:
ÁGUA FRIA: comprimento de tubo (m) por diâmetro (15, 20, 25, 32, 40, 50, 60, 75, 100mm)
ÁGUA QUENTE: comprimento de tubo (m) por diâmetro — distinguir das linhas de fria
ESGOTO: comprimento (m) por diâmetro — identificar ramais, colunas, coletores
VENTILAÇÃO: tubos de ventilação (m) por diâmetro
REGISTROS/VÁLVULAS: contar por tipo e diâmetro
RALOS/CAIXAS: contar ralos sifonados, caixas sifonadas, caixas de inspeção
LOUÇAS: bacia, lavatório, cuba, mictório, chuveiro — contar por símbolo
CALHAS: comprimento linear (m) e tipo
RESERVATÓRIO: volume (L) e tipo se indicado

SINAPIs úteis: Tubo PVC 25mm água: 89837 | 32mm: 89838 | 50mm: 89839 | 75mm: 89840 | 100mm: 89841
Tubo PVC esgoto 50mm: 89850 | 75mm: 89851 | 100mm: 89852 | 150mm: 89855
Tubo CPVC 22mm: 89860 | Tubo PPR 20mm: 89861
Ralo sifonado 100mm: 89870 | Caixa sifonada: 89871 | Caixa inspeção: 89858
Registro gaveta 25mm: 89842 | Válvula de descarga: 89875
Bacia: 86896 | Lavatório: 86897 | Mictório: 86905
${BASE_INSTRUCOES}`,

  "Pluvial": `Especialista em drenagem pluvial predial e urbana brasileira (ABNT NBR 10844).

Extraia do desenho:
TUBULAÇÕES HORIZONTAIS: comprimento (m) por diâmetro — leia inclinação i= indicada
PRUMADAS/TUBOS DE QUEDA: contar símbolo por símbolo (PLD, TQ) e indicar diâmetro
RALOS: contar cada ralo circular indicado na laje/cobertura
CALHAS: comprimento linear (m) por largura
CAIXAS DE INSPEÇÃO: contar por tamanho (30x30, 60x60, 80x80)
CONEXÕES: estimar joelhos e tês pelas mudanças de direção visíveis
BLOCOS DE ANCORAGEM: 1 por prumada conforme detalhe
INCLINAÇÃO: registrar i= anotada nas tubulações horizontais

SINAPIs úteis: Tubo PVC SR 75mm: 89852 | 100mm: 89853 | 150mm: 89854
Joelho 90° PVC SR 100mm: 89855 | Tê PVC SR 100mm: 89856
Ralo circular 100mm: 89857 | Caixa inspeção 60x60: 89858
Calha PVC: 89860 | Calha galvanizada: 88504
Bloco ancoragem concreto: 74010 | Cinta fixação: 89862
${BASE_INSTRUCOES}`,

  "Incêndio": `Especialista em sistemas de prevenção e combate a incêndio brasileiros (ABNT NBR 13714/13752/17240).

Extraia do desenho:
SPRINKLERS: contar cada cabeça de sprinkler por tipo (pendant, upright, sidewall)
TUBULAÇÕES SPRINKLER: comprimento (m) por diâmetro — aço galvanizado ou CPVC
HIDRANTES: contar abrigos de hidrante por tipo (tipo 1, 2, 3)
TUBULAÇÕES HIDRANTE: comprimento (m) por diâmetro (65, 80mm)
DETECTORES: contar detectores de fumaça, calor, chama
ACIONADORES MANUAIS: contar botoeiras de acionamento
CENTRAL DE ALARME: contar central e repetidoras
ILUMINAÇÃO DE EMERGÊNCIA: contar blocos autônomos e luminárias de emergência
SINALIZAÇÃO: contar placas fotoluminescentes
EXTINTORES: contar pontos de extintor por tipo (CO2, Pó, Água)
RESERVA TÉCNICA: volume indicado no desenho

SINAPIs úteis: Sprinkler pendant: 74300 | Sprinkler upright: 74301
Tubo aço galv. 1": 74156 | 1.1/4": 74157 | 1.1/2": 74158 | 2": 74159 | 2.1/2": 74160
Hidrante tipo 2: 74310 | Mangueira 15m: 74311 | Esguicho: 74312
Detector fumaça: 74320 | Detector calor: 74321 | Acionador manual: 74322
Central alarme: 74323 | Ilum. emergência: 91947 | Placa sinalização: 74330
Extintor CO2 6kg: 74340 | Extintor pó 6kg: 74341
${BASE_INSTRUCOES}`,

  "HVAC": `Especialista em sistemas de climatização e ventilação predial/industrial (ABNT NBR 16401).

Extraia do desenho:
SPLITS/FAN-COILS: contar por capacidade em BTU/h — leia a anotação junto ao símbolo
DUTOS DE AR: área de chapa (m²) = comprimento × perímetro da seção
DUTOS FLEXÍVEIS: comprimento linear (m)
DIFUSORES/GRELHAS: contar por tipo (insuflamento, retorno, exaustão)
CASAS DE MÁQUINAS: contar chillers, fancoils centrais, torres de resfriamento
TUBULAÇÕES DE ÁGUA GELADA: comprimento (m) por diâmetro
EQUIPAMENTOS: UTA, UTAE, VRF — contar por modelo indicado
VENTILADORES/EXAUSTORES: contar por tipo
ISOLAMENTO TÉRMICO: m² de duto com isolamento indicado

SINAPIs úteis: Split 9000 BTU: 88315 | 12000: 88316 | 18000: 88317 | 24000: 88318
Split cassete 36000: 88319 | VRF (unidade externa): 88325
Duto chapa galv. seção ret.: 88320 | Duto flexível: 88322
Difusor insuflamento 300x300: 88321 | Grelha retorno: 88323
Chiller 30TR: 88330 | Fan-coil: 88331 | Torre resfriamento: 88332
Isolamento lã rocha duto: 88335 | Isolamento elastômero: 88336
${BASE_INSTRUCOES}`,

  "CFTV": `Especialista em sistemas de CFTV, segurança eletrônica e automação predial brasileiros.

Extraia do desenho:
CÂMERAS: contar por tipo (dome, bullet, PTZ, 360°) — ler anotação junto ao símbolo
CABOS: comprimento (m) por tipo — coaxial RG59, UTP Cat6, fibra óptica
ELETRODUTOS: comprimento (m) por diâmetro para passagem dos cabos
DVR/NVR: contar por quantidade de canais
NOBREAKS: contar por potência indicada
RACKSS/GABINETES: contar e dimensão
CATRACAS/TORNIQUETES: contar
LEITORES DE ACESSO: contar por tipo (proximidade, biometria)
INTERFONES: contar pontos
CONTROLES DE ACESSO: contar centrais e periféricos

SINAPIs úteis: Câmera dome IP: 91960 | Câmera bullet: 91961 | Câmera PTZ: 91962
Cabo UTP Cat6: 91970 | Cabo coaxial RG59: 91971 | Cabo fibra óptica: 91972
Eletroduto PVC 25mm: 91911 | Eletroduto PVC 32mm: 91912
NVR 16 canais: 91975 | DVR 16 canais: 91976 | Nobreak 1kVA: 91977
Rack 12U: 91980 | Patch panel Cat6: 91981
${BASE_INSTRUCOES}`,

  "Dados e Voz": `Especialista em infraestrutura de redes, cabeamento estruturado e telecomunicações (ABNT NBR 14565).

Extraia do desenho:
PONTOS DE REDE: contar tomadas RJ45 por ambiente — ler símbolo quadrado com T ou R
CABOS UTP: comprimento (m) por categoria (Cat5e, Cat6, Cat6A)
ELETRODUTOS: comprimento (m) por diâmetro para passagem de cabos
ELETROCALHAS/BANDEJAS: comprimento linear (m) por tamanho
PATCH PANELS: contar por quantidade de portas (24, 48)
SWITCHES: contar por quantidade de portas
RACKS: contar e dimensão (12U, 24U, 42U)
PONTOS DE TELEFONE: contar tomadas RJ11
DG (distribuidor geral): contar
FIBRA ÓPTICA: comprimento (m) — linhão principal backbone

SINAPIs úteis: Cabo UTP Cat6: 91970 | Cabo Cat6A: 91973 | Cabo fibra óptica: 91972
Eletroduto PVC 25mm: 91911 | Eletroduto PVC 32mm: 91912
Bandeja 100x50: 91935 | Bandeja 200x50: 91936
Patch panel Cat6 24p: 91981 | Switch 24p: 91982 | Rack 24U: 91983
Tomada RJ45 Cat6: 91984 | Tomada RJ11: 91985
${BASE_INSTRUCOES}`,

  "SPDA": `Especialista em Sistemas de Proteção contra Descargas Atmosféricas (ABNT NBR 5419).

Extraia do desenho:
CAPTORES: contar hastes Franklin, gaiola Faraday, sistema ESE — ler tipo indicado
CABOS DESCENDENTES: comprimento linear (m) do cabo de descida (cobre nu 50mm²)
ANEL DE ATERRAMENTO: comprimento (m) do barramento perimetral
HASTES DE ATERRAMENTO: contar hastes cobre 5/8" ou similares
CAIXAS DE INSPEÇÃO (SPDA): contar caixas de junção para aterramento
CONECTORES/GRAMPOS: estimar pelo número de conexões visíveis
DPS (dispositivos de proteção): contar por tipo (classe I, II, III)
CABO MALHA EQUIPOTENCIAL: comprimento (m) no telhado/cobertura

SINAPIs úteis: Haste aterramento cobre 5/8"x2,4m: 91960 | Cabo cobre nu 50mm²: 91961
Caixa inspeção SPDA: 91962 | Captor Franklin: 91963 | Conector bronze: 91964
DPS classe II: 91965 | Barramento aterramento: 91966
Cabo cobre nu 35mm²: 91967 | Cabo cobre nu 70mm²: 91968
${BASE_INSTRUCOES}`,

  "Gás Industrial": `Especialista em instalações de gás industrial e de processo (ABNT NBR 15526 e normas Petrobras/BYD).

Extraia do desenho:
TUBULAÇÕES: comprimento (m) por diâmetro e material (aço carbono, cobre, PEAD, inox)
VÁLVULAS: contar por tipo (esfera, gaveta, borboleta, retenção) e diâmetro
CONEXÕES: estimar cotovelos, tês, reduções pelas mudanças de direção
INSTRUMENTAÇÃO: contar manômetros, transmissores de pressão, fluxômetros
SUPORTES: estimar pela distância entre suportes (a cada 1,5m para aço ≤2")
ISOLAMENTO: m linear de tubo com isolamento térmico indicado
EQUIPAMENTOS: reguladores, filtros, separadores — contar por símbolo
ANCORAGEM E FIXAÇÃO: blocos de ancoragem em mudanças de direção

SINAPIs úteis: Tubo aço carbono 1": 74156 | 2": 74157 | 3": 74158 | 4": 74159 | 6": 74160
Tubo cobre 15mm: 74161 | Tubo cobre 28mm: 74162
Válvula esfera inox 1": 74163 | Válvula esfera inox 2": 74164
Suporte tipo sela até 2": 74165 | Isolamento lã rocha tubo: 74166
Regulador pressão: 74203 | Manômetro: 74204 | Válvula alívio: 74205
${BASE_INSTRUCOES}`,

};

export function getPrompt(disciplina) {
  return PROMPTS[disciplina] || `Especialista em engenharia civil brasileira.

Analise a planta e extraia TODOS os quantitativos do desenho, medindo pelas cotas visíveis e contando símbolos.
Para cada item sugira o código SINAPI Bahia Não Desonerado mais preciso.
${BASE_INSTRUCOES}`;
}
