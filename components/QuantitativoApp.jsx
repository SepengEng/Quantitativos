"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { SINAPI_BA } from "../lib/sinapi";

// ─── LOOKUP SINAPI (fallback local ~150 itens, usado só se API falhar) ───────
const SINAPI_MAP = Object.fromEntries(
  SINAPI_BA.map(i => [String(i.codigo).replace(/\/\d+$/, ""), i])
);
function getSinapiPrecoLocal(codigo) {
  if (!codigo) return null;
  const key = String(codigo).replace(/\/\d+$/, "");
  return SINAPI_MAP[key]?.preco || null;
}

// Resolve preços + unidades SINAPI para validação cruzada
async function resolverPrecosBatch(itens) {
  const precoMap = {};
  const unMap    = {}; // codigo → unidade real no SINAPI
  const semPreco = [];

  // 1ª passagem: batch por código
  const codigos = [...new Set([
    ...itens.map(i => i.sinapi_sugerido),
    ...itens.map(i => i.mat_sinapi),
  ].filter(Boolean))];
  if (codigos.length) {
    try {
      const r = await fetch(`/api/sinapi?codigos=${encodeURIComponent(codigos.join(","))}`);
      const d = await r.json();
      if (d.mapa) Object.entries(d.mapa).forEach(([cod, item]) => {
        precoMap[cod] = item.preco;
        unMap[cod]    = item.un;
      });
    } catch {}
  }

  // 2ª passagem: sem preço → busca semântica com UN para ranquear melhor
  itens.forEach(it => { if (!precoMap[it.sinapi_sugerido]) semPreco.push(it); });

  await Promise.all(semPreco.map(async it => {
    const desc = it.sinapi_descricao || it.descricao || "";
    if (!desc) return;
    try {
      const params = new URLSearchParams({ match: desc, top: "3" });
      if (it.un) params.set("un", it.un);
      const r = await fetch(`/api/sinapi?${params}`);
      const d = await r.json();
      if (d.item?.preco) {
        precoMap[it.sinapi_sugerido || desc] = d.item.preco;
        unMap[it.sinapi_sugerido || desc]    = d.item.un;
        it._sinapi_real = { codigo: d.item.codigo, descricao: d.item.descricao, preco: d.item.preco, un: d.item.un };
        it._sinapi_top3 = d.top3 || [];
      }
    } catch {}
  }));

  return { precoMap, unMap };
}

// ─── UPLOAD DIRETO PARA GEMINI FILE API (contorna limite 4,5 MB do Vercel) ───
// PDFs grandes são enviados direto para o Google; o servidor recebe só a URI.
async function uploadParaGeminiFileAPI(file, onStatus) {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) throw new Error("NEXT_PUBLIC_GEMINI_API_KEY não configurada");

  onStatus?.(`Enviando ${(file.size/1024/1024).toFixed(1)} MB para Gemini...`);

  const form = new FormData();
  form.append("file", file, file.name);

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    { method: "POST", body: form }
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Upload Gemini: ${err.error?.message || resp.status}`);
  }
  const data = await resp.json();
  const fileUri  = data.file?.uri;
  const fileName = data.file?.name; // "files/abc123"
  if (!fileUri) throw new Error("Gemini não retornou URI do arquivo");

  // Aguarda estado ACTIVE (PDFs ficam ativos quase imediatamente)
  for (let i = 0; i < 8; i++) {
    const st = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`
    ).then(r => r.json()).catch(() => ({}));
    if (!st.state || st.state === "ACTIVE") break;
    onStatus?.(`Processando arquivo... (${i+1}/8)`);
    await new Promise(r => setTimeout(r, 2000));
  }

  return { fileUri, mimeType: data.file?.mimeType || file.type };
}

// ─── DETECÇÃO DE DISCIPLINA ───────────────────────────────────────────────────
const PREFIXOS = {
  "ARQ":"Arquitetura","EST":"Estrutura","ELE":"Elétrica",
  "HID":"Hidrossanitária","PLU":"Pluvial","DRE":"Pluvial",
  "INC":"Incêndio","SPK":"Incêndio","HVA":"HVAC","ACL":"HVAC",
  "CFT":"CFTV","CAM":"CFTV","VOZ":"Dados e Voz","DAD":"Dados e Voz",
  "SPD":"SPDA","GAS":"Gás Industrial","TUB":"Gás Industrial","MEC":"Mecânica",
};
// BYD: mapa de códigos de disciplina conforme NI-PH00.00.GE/ED.GE0-001
const BYD_DISC = {
  "AC":"Arquitetura",   // Architecture
  "UR":"Arquitetura",   // Urbanization
  "PR":"Arquitetura",   // Preliminary Services
  "EM":"Arquitetura",   // Earthmove
  "IM":"Arquitetura",   // Waterproofing
  "RS":"Arquitetura",   // Road System
  "ST":"EstruturaMet",  // Steel Structure (scope: another company)
  "CE":"Estrutura",     // Concrete Structure
  "FD":"Estrutura",     // Foundation
  "SR":"Estrutura",     // Soil Retaining Structures
  "DN":"Pluvial",       // Drainage
  "WS":"Hidrossanitária", // Water Supply & Sewage
  "IE":"Hidrossanitária", // Industrial Efluents
  "PS":"Elétrica",      // Power Supply
  "HM":"Elétrica",      // High/Medium Voltage
  "LV":"Elétrica",      // Low Voltage
  "EL":"Elétrica",      // Electric (Dormitory)
  "HV":"HVAC",          // HVAC
  "AS":"HVAC",          // Auxiliary Systems (AC/compressed air/LPG)
  "FS":"Incêndio",      // Firefighting System
  "GP":"SPDA",          // General Protection (grounding/lightning)
  "TL":"Dados e Voz",   // Telecommunication
  "GA":"Gás Industrial",// Gas (Dormitory)
  "PP":"Gás Industrial",// Piping
  "IA":"Especificação", // Instrumentation & Automation
  "EQ":"Especificação", // Equipment
  "PC":"Especificação", // Process
  "IR":"Hidrossanitária",// Irrigation
};
function detectarDisciplina(fileName) {
  if (!fileName) return null;
  const u = fileName.toUpperCase();
  // BYD: padrão ED.XX# ou BD.XX# ou LD.XX# (ex: _ED.ST1, _ED.AC2)
  const bydMatch = u.match(/(?:ED|BD|LD)\.([A-Z]{2,3})\d/);
  if (bydMatch) {
    const d = BYD_DISC[bydMatch[1]];
    if (d) return d;
  }
  // Checar prefixos padrão (início do nome ou entre separadores)
  for (const [p,d] of Object.entries(PREFIXOS)) {
    if (u.startsWith(p)||u.includes(`-${p}-`)||u.includes(`_${p}_`)||u.includes(`-${p}_`)||u.includes(`_${p}-`)) return d;
  }
  return null;
}

// Detecta tipo de prancha pelo nome do arquivo para injetar aviso no prompt
function detectarTipoPrancha(fileName) {
  if (!fileName) return null;
  const u = fileName.toUpperCase();
  // Prefixo CM = Memória de Cálculo (calculation memory) — não extraia quantidades
  if (u.startsWith("CM-") || u.includes("/CM-") || u.includes("_CM-")) return "memoria_calculo";
  // Arquivo com "DETALHE" no nome
  if (u.includes("DETALHE") || u.includes("DETAIL") || u.includes("-DET")) return "detalhe";
  // Arquivo com "ISO" no nome
  if (u.includes("ISO") || u.includes("ISOMETRIC")) return "isometrico";
  return null;
}

function avisoTipoPrancha(fileName) {
  const tipo = detectarTipoPrancha(fileName);
  if (!tipo) return "";
  if (tipo === "memoria_calculo") return "\n⚠️ ESTE DOCUMENTO É UMA MEMÓRIA DE CÁLCULO — Não extraia quantidades daqui. Use apenas para confirmar especificações técnicas de equipamentos (potência, modelo, parâmetros). As quantidades vêm da planta de layout correspondente.\n";
  if (tipo === "detalhe") return "\n⚠️ ESTA PRANCHA É DE DETALHE CONSTRUTIVO — Não extraia quantidades. Mostra COMO executar um elemento típico, não QUANTOS existem. Os elementos já estão contabilizados na planta baixa.\n";
  if (tipo === "isometrico") return "\n⚠️ ESTA PRANCHA É UM ISOMÉTRICO/PERSPECTIVA — Não extraia quantidades. Perspectiva para facilitar execução; quantidades vêm da planta baixa e do corte.\n";
  return "";
}

// ─── PROMPTS POR DISCIPLINA ───────────────────────────────────────────────────
const BASE = `
INSTRUÇÕES DE ORÇAMENTISTA PROFISSIONAL:
1. Leia o cabeçalho/título do desenho para identificar: tipo de prancha (planta/corte/detalhe/memória), escala, disciplina e número de revisão
2. Use TODAS as informações disponíveis: cotas explícitas, tabelas de materiais, quadros de esquadrias, legendas, notas técnicas, hachuras e símbolos
3. Para tabelas de materiais/armação no desenho: extraia diretamente os dados (dimensões, quantidades, seções)
4. Quando não houver cota explícita: estime pela escala do desenho, prática construtiva típica ou contexto — e marque como Inferência
5. NUNCA retorne lista vazia se houver qualquer elemento quantificável visível — extraia o máximo possível
6. Para cada item, sugira o código SINAPI Bahia Não Desonerado mais preciso

HIERARQUIA DE PRANCHAS — REGRA FUNDAMENTAL:
Ao processar UMA prancha individualmente, identifique o tipo dela e extraia APENAS os elementos que essa prancha é responsável por mostrar:
▶ PLANTA BAIXA (plan view): FONTE PRIMÁRIA — extraia todas as quantidades visíveis NESTA PRANCHA
▶ CORTE / ELEVAÇÃO: extraia só o que NÃO está na planta (alturas, espessuras) — NÃO re-extraia elementos que a planta já cobre
▶ FACHADA: NÃO extraia quantidades — confirma existência, não gera medição própria
▶ SUB-DETALHE DENTRO DA PRANCHA (ex: "Detalhe 1", "Modelo 1"): NÃO extraia — mostra como construir UM exemplo típico, os elementos já estão contados na vista principal da mesma prancha
▶ MEMÓRIA DE CÁLCULO / RELATÓRIO (arquivo CM-...): NÃO extraia quantidades — só referência técnica

REGRA ANTI-DUPLICAÇÃO — SOMENTE DENTRO DESTA PRANCHA:
- Dentro desta prancha, cada elemento físico deve aparecer UMA ÚNICA VEZ no JSON
- Se um pilar aparece na vista em planta E no corte transversal DENTRO DO MESMO PDF: conte só uma vez (pela planta)
- Se esta prancha tem uma "vista principal" (planta) e sub-detalhes: extraia da vista principal, ignore os sub-detalhes
- CADA PRANCHA É PROCESSADA ISOLADAMENTE — não se preocupe com o que outras pranchas do mesmo projeto extraíram; o sistema pós-processa duplicatas automaticamente

IMPORTANTE — EXTRAIA TUDO QUE ESTA PRANCHA MOSTRA:
- Cada prancha de um projeto tem responsabilidade sobre elementos específicos
- CE2-001 = pilares → extraia pilares; CE2-002 = vigas → extraia vigas; CE2-003 = vigas cobertura → extraia vigas cobertura
- DN5-001 = cobertura (áreas de contribuição) → extraia; DN5-002 = piso (calhas/tubulações) → extraia itens do piso
- NUNCA retorne lista vazia para uma planta baixa com elementos visíveis, mesmo que outros PDFs do projeto existam

REGRAS DE ESCALA — CRÍTICO:
- Confirme a escala indicada no cabeçalho (ex: 1:50, 1:100, 1:150, 1:200)
- Dimensões anotadas em cotas já estão em unidade real (geralmente cm ou mm) — não converta pela escala
- Só use a escala para estimar dimensões SEM cota explícita
- Identifique a unidade das cotas: projetos BYD/industriais usam MILÍMETROS para dimensões de detalhes e METROS para dimensões gerais
- Cota "1040" em planta estrutural 1:150 = 10.40m (em cm) — leia como está indicado no título de cotas

Fonte de medição a usar em cada item:
"📐 Cota" = dimensão lida de cota explícita no desenho
"🔢 Contagem" = elementos contados símbolo a símbolo
"🧮 Cálculo" = calculado a partir de cotas (área = L×C, volume = área×esp, etc.)
"🔍 Inferência" = estimado por escala, tabela de armação ou prática construtiva

Retorne APENAS JSON válido sem texto antes ou depois:
{"disciplina":"...","escala":"1:XX","resumo":"descrição do que o desenho representa e principais dimensões encontradas","itens":[{"codigo_item":"XXX-001","localizacao":"Local/aplicação no projeto (ex: Fundação - Sapatas, Piso térreo, Fachada norte)","descricao":"descrição técnica completa do serviço","un":"m|m²|m³|un|kg","qtd":0.00,"confianca":"alta|media|baixa","fonte":"📐 Cota","obs":"como foi medido especificamente","sinapi_sugerido":"XXXXX","sinapi_descricao":"descrição curta SINAPI","mat_sinapi":"XXXXX","mat_descricao":"Fornecimento de [material específico]","mat_ind":1.00,"mo_sinapi":"XXXXX","mo_descricao":"Execução/Instalação de [serviço]","mo_itens":[{"tipo":"Pedreiro","un":"h","ind":1.5},{"tipo":"Servente","un":"h","ind":2.0}]}],"alertas":["itens a confirmar em campo"]}
Regras de confiança: "alta"=cota explícita ou contagem direta; "media"=calculado de cotas ou tabela de armação; "baixa"=estimativa por escala ou inferência.
Nota: para itens só-MAT (fornecimento puro) omita mo_sinapi/mo_itens; para itens só-MO omita mat_sinapi/mat_ind.`;

const PROMPTS = {
"Arquitetura":`Especialista em arquitetura predial/industrial.

TIPO DE PRANCHA — REGRAS:
▶ PLANTA BAIXA: extraia paredes, pisos, esquadrias, ambientes — é a fonte de todas as quantidades
▶ CORTE / ELEVAÇÃO: confirme pé-direito e detalhes de esquadrias — NÃO reextraia paredes já medidas na planta
▶ DETALHE DE ESQUADRIA: NÃO extraia — esses elementos já foram contados na planta pelo quadro de esquadrias

COMO MEDIR:
- PAREDES: meça comprimento horizontal total de cada segmento em planta × altura (do piso ao teto) = m² por tipo de alvenaria. Deduza aberturas de portas e janelas. Não some com elevações/fachadas.
- PISO: área de cada ambiente ou zona em planta (L×C em metros) = m². Não soma piso + forro + paredes como se fossem iguais.
- ESQUADRIAS: conte cada símbolo no quadro de portas/janelas pelo gabarito: qtd × largura × altura = m² (para alumínio/vidro) ou unidade (para portas).
- COBERTURA: leia a área em planta de cobertura. Se telha metálica → escopo da estrutura metálica (verifique). Marquises de concreto → inclua.
- MARQUISE/PLATIBANDA DE CONCRETO: inclua somente se for estrutura de concreto armado (CE), não se for metálica (ST).

PAREDES ESPECIAIS EM ARMAZÉNS/FÁBRICAS:
- Paredes corta-fogo (firewall) resistência ≥2h: identifique pelo símbolo ou nota — inclua separado como "Alvenaria corta-fogo"
- Blocos de concreto celular/estrutural são comuns em paredes externas industriais
- Paredes internas divisórias entre células de armazém = dividas por tipo de alvenaria

SINAPIs: Alv.9cm:87451|14cm:87452|Bl.concreto estrutural:89714|Drywall 48mm:90762|73mm:90763|Porcelanato 60x60:87893|Cerâmica parede:87264|Pintura tinta acrílica:87880|Reboco:87529|Porta aço 0,90:88511|Janela alumínio correr:88520|Split 18000:88317|Bacia:86896|Lavatório:86897|Telha fibrocimento:88500|Impermeab.manta:88497|Concreto polido piso:94992|Piso industrial (epóxi/polido):94992
${BASE}`,

"Estrutura":`Especialista em estruturas de concreto armado e fundações (NBR 6118/6122).

TIPO DE PRANCHA — REGRAS CRÍTICAS:
▶ CE = Concreto Estrutural. Cada prancha CE tem elementos DISTINTOS — extraia tudo o que ela mostra:
   • CE-001 (Posicionamento de Pilares): extraia PILARES — seção, quantidade, altura
   • CE-002 (Vigas 1º Pavimento): extraia VIGAS DO 1º PAVIMENTO — tipo, comprimento, seção
   • CE-003 (Vigas de Cobertura): extraia VIGAS DA COBERTURA — tipo, comprimento, seção
   • NÃO pule uma prancha porque "já extraiu estrutura de outra CE" — cada CE trata elementos diferentes
▶ FD = Fundação. Extraia daqui: sapatas isoladas (por tipo da tabela), vigas de fundação/baldrame, blocos de coroamento
▶ SUB-DETALHE dentro de uma prancha CE (ex: "MODELO 1 DA MARQUISE", "SEÇÃO TRANSVERSAL KZ1"): use só para confirmar dimensões, NÃO conte como item adicional — o elemento já está na vista principal da prancha

ESCOPO SEPENG — MUITO IMPORTANTE:
✅ INCLUIR: Concreto (m³), Formas (m²), Escavação de fundação (m³)
❌ EXCLUIR SEMPRE: Aço CA-50, CA-60, tela soldada, armadura — esses itens são executados por outra empresa

COMO CALCULAR CONCRETO:
- PILAR: seção (m²) × altura (m) × quantidade = m³. Altura = diferença entre "Topo da Fundação" e "Topo da Cobertura" na tabela de pavimentos.
- VIGA: seção (m²) × comprimento total dos vãos (m) = m³. Use a tabela de identificação de vigas para tipo e seção.
- SAPATA ISOLADA: largura × comprimento × altura (da tabela de dimensionamento) × quantidade = m³
- VIGA DE FUNDAÇÃO/BALDRAME: seção × comprimento total = m³
- LAJE: área (m²) × espessura (m) = m³

COMO CALCULAR FORMAS:
- PILAR: perímetro da seção (m) × altura (m) × quantidade = m²
- VIGA: (2 × altura + largura) × comprimento = m² (sem descontar apoios)
- SAPATA: área lateral da sapata = 4 × lado × altura do bloco
- NÃO inclua formas para peças com seção circular sem forma (ex: estacas)

TABELAS DE DIMENSIONAMENTO (comuns em projetos BYD/industrial):
- Tabela de pilares: lista KZ1, KZ2, etc. com seção e armação por andar
- Tabela de fundações: lista J01, J02, etc. com dimensões A1, A2, B1, B2, H1, H2
- Tabela de pavimentos: lista cotas de piso, topo da fundação e topo da cobertura → calcule alturas reais dos pilares

SINAPIs: Concreto FCK20 bombeado:96527|FCK25:96528|FCK30:96529|FCK35:96532|Forma compensada pilares:94965|Forma compensada vigas:94966|Forma laje:94967|Escavação manual 1,5m:73961|Escavação mecanizada:73964|Brita calçamento:74232|Lastro concreto magro:94990
${BASE}`,

"Elétrica":`Especialista em elétrica predial/industrial (NBR 5410 / NR-10).

TIPO DE PRANCHA — REGRAS:
▶ PLANTA BAIXA (PS6-001 ou similar): FONTE PRIMÁRIA — extraia aqui luminaires e eletrodutos
▶ DETALHES DE INSTALAÇÃO (PS6-002 ou similar): NÃO extraia quantidades — mostra método de fixação e componentes de uma instalação típica, não contagem total
▶ UNIFILARES/DIAGRAMAS: extraia quadros, disjuntores, cargas — não reextraia eletrodutos já medidos na planta

INSTALAÇÕES EM ATMOSFERA EXPLOSIVA (ATEX/HAZARDOUS AREA):
- Depósitos de resíduos perigosos, refinarias, armazéns de produtos inflamáveis → ZONA 1 ou ZONA 2
- Eletroduto deve ser AÇO GALVANIZADO (não PVC) com conexões vedadas
- Luminárias devem ser À PROVA DE EXPLOSÃO (Ex d / Ex e classificação ATEX)
- Painéis elétricos → também à prova de explosão
- Os acessórios (uniões vedadas, abrações tipo D, vedadores de rosca) são componentes do eletroduto — inclua separado

COMO MEDIR ELETRODUTOS:
- Meça comprimento linear pelo trajeto indicado na planta (distância entre pontos de alimentação e luminária/equipamento)
- Projetos industriais usam principalmente eletroduto rígido metálico (aço galvanizado) — não PVC
- Anote o diâmetro em polegadas ou mm conforme indicado no desenho

COMO CONTAR LUMINÁRIAS:
- Conte cada símbolo de luminária na planta — cada símbolo = 1 equipamento
- Identifique o tipo pelo código (ex: TAL1.M1.3,5,7 = tipo 1, módulo 1, circulitos 3/5/7)
- Projetos industriais/ATEX usem LED tubular 2×54W ou módulo LED à prova de explosão

SINAPIs: Eletroduto PVC 25mm:91911|32mm:91912|50mm:91913|Eletroduto aço galv.(rígido) 3/4":91914|1":91915|1.1/2":91916|Bandeja 100x50:91935|200x50:91936|Cabo 2,5mm²:91925|4mm²:91926|6mm²:91927|10mm²:91928|16mm²:91929|Tomada 20A:91940|Luminária LED 40W:91945|Luminária industrial 100W (à prova explosão):91946|Quadro elétrico:91950|Disjuntor bip.20A:91951|Disjuntor trip.40A:91952
${BASE}`,

"Hidrossanitária":`Especialista em hidrossanitária (NBR 5626/8160). Extraia: ÁGUA FRIA (m por ø), ÁGUA QUENTE (m por ø), ESGOTO (m por ø — ramais/colunas), VENTILAÇÃO (m), REGISTROS/VÁLVULAS (qtd por tipo), RALOS/CAIXAS (contar símbolos), LOUÇAS/METAIS (símbolo a símbolo).
SINAPIs: Água PVC 25mm:89837|32mm:89838|50mm:89839|75mm:89840|100mm:89841|Esgoto 50mm:89850|75mm:89851|100mm:89852|150mm:89855|Ralo sifonado:89870|Cx sifonada:89871|Cx inspeção:89858|Registro gaveta:89842|Bacia:86896|Lavatório:86897
${BASE}`,

"Pluvial":`Especialista em drenagem pluvial/águas pluviais (NBR 10844).

TIPO DE PRANCHA — REGRAS (cada prancha tem elementos distintos, extraia o que ELA mostra):
▶ PLANTA DE COBERTURA (DN-001): extraia → áreas de contribuição por zona (m²), posição e quantidade de descidas/ralos de cobertura, diâmetro de calhas de cobertura. NÃO extraia calhas de piso daqui.
▶ PLANTA DE PISO (DN-002): extraia → comprimento de calhas a nível do solo (m), tubulações subterrâneas (m por diâmetro), caixas coletoras (un). NÃO reextraia as descidas de cobertura já extraídas da planta de cobertura.
▶ FACHADAS/CORTES (DN-003): NÃO extraia — mostram as mesmas calhas do piso em elevação, sem quantidades novas
▶ DETALHES (DN-004): NÃO extraia — mostram como construir UM exemplar típico de caixa/calha; use só para confirmar dimensões da seção

COMO MEDIR:
- CALHAS EM CONCRETO: meça comprimento linear total das calhas no PISO pelo trajeto na planta. A seção vem dos detalhes. NÃO some calha do piso + calha da fachada + calha do detalhe (são a mesma).
- DESCIDAS/PRUMADAS: conte símbolo a símbolo na planta de cobertura. 1 símbolo = 1 descida (tubo vertical). Comprimento = altura do edifício (aprox 5–7m).
- CAIXAS COLETORAS DE CONCRETO: conte na planta de piso onde há mudança de direção ou ponto de inspeção
- TUBULAÇÕES SUBTERRÂNEAS (PEAD): meça comprimento na planta de piso até o ponto de saída para infraestrutura externa. Diâmetro indicado no símbolo (ex: Ø400).
- POÇOS DE VISITA: conte na planta ou note a existência nos detalhes

ITENS TÍPICOS DRENAGEM INDUSTRIAL:
- Calha em concreto armado ≥ 300×300mm (dimensões no detalhe) — medir em metros lineares
- Caixa coletora em concreto (câmara) — medir em unidade
- Tubo PEAD corrugado (Ø400-600) — medir em metros
- Grelha metálica sobre calha — medir em metros (igual comprimento da calha)
- Poço de visita pré-moldado — contar

SINAPIs: Tubo PVC SR 75mm:89852|100mm:89853|150mm:89854|Tubo PEAD 200mm:89860|400mm:89863|Joelho 90° PVC 100mm:89855|Tê PVC:89856|Ralo PVC 100mm:89857|Cx inspeção concreto 60x60:89858|Cx inspeção concreto 100x100:89859|Calha concreto armado:94989|Calha metálica calha:88504|Poço de visita PVC Ø600:73830|Bloco ancoragem:74010
${BASE}`,

"Incêndio":`Especialista em sistemas de proteção contra incêndio (NBR 13714/13752/17240/IT CBMBA).

TIPO DE PRANCHA — REGRAS:
▶ PLANTA BAIXA (FS1-001 ou planta geral): FONTE PRIMÁRIA — conte todos os equipamentos aqui
▶ ISOMÉTRICO / VISTA ESQUEMÁTICA: NÃO reextraia — perspectiva do que já está na planta
▶ DETALHE DE ACIONADOR/HIDRANTE: NÃO extraia — mostra o componente, não a quantidade total

COMO CONTAR:
- SPRINKLERS: conte símbolo a símbolo. Identifique tipo: pendant (pendente, mais comum em teto), upright (em cima), sidewall (parede). Para armazéns industriais com risco alto: sprinkler ESFR ou K≥14 pode ser especificado.
- HIDRANTES: conte cada símbolo de hidrante (distinção: hidrante de parede = 1 ponto com mangueira; hidrante de coluna = independente)
- EXTINTORES: conte símbolo a símbolo por tipo (CO2, pó seco, água, espuma, hídrico). Armazéns perigosos usam pó seco e CO2.
- DETECTORES: conte por tipo — chama (ícone de chama), fumaça (ícone de ponto ou nuvem), calor (H). Para ATEX: detectores à prova de explosão.
- ACIONADORES MANUAIS: conte em corredores e saídas. Para armazéns: 1 por módulo/célula no mínimo.
- CENTRAL DE ALARME: 1 por edifício normalmente (contar unidade)
- TUBULAÇÕES: meça em metros por ø (1", 1.1/2", 2", 2.1/2", 4") — anote material (aço galvanizado Schedule 40)

ATENÇÃO PARA DEPÓSITOS DE RESÍDUOS PERIGOSOS (ATEX):
- Detectores serão de chama (FLAME DETECTOR) — não fumaça
- Acionadores manuais à prova de explosão
- Notificadores A/V (áudio-visual) à prova de explosão
- Sprinklers podem ser substituídos por sistema deluge/espuma dependendo da classe do resíduo

SINAPIs: Sprinkler pendant:74300|upright:74301|Aço galv.1":74156|1.1/2":74158|2":74159|2.1/2":74160|Hidrante tipo 2:74310|Mangueira 15m:74311|Detector chama:74321|Detector fumaça:74320|Acionador manual:74322|Central alarme:74323|Notificador AV:74324|Extintor CO2 6kg:74340|Extintor pó 6kg:74341|Extintor espuma:74342|Placa sinalização:74330
${BASE}`,

"HVAC":`Especialista em climatização (NBR 16401). Extraia: SPLITS/FAN-COILS (contar por BTU/h), DUTOS (m² chapa=comp×perímetro seção), DUTOS FLEXÍVEIS (m linear), DIFUSORES/GRELHAS (contar por tipo), EQUIPAMENTOS (UTA/VRF/chiller — contar), TUB.ÁGUA GELADA (m por ø), ISOLAMENTO DUTOS (m²).
SINAPIs: Split 9000:88315|12000:88316|18000:88317|24000:88318|Cassete 36000:88319|Duto chapa galv.:88320|Duto flexível:88322|Difusor 300x300:88321|Grelha retorno:88323|Chiller 30TR:88330|Fan-coil:88331|Isolamento duto:88335
${BASE}`,

"CFTV":`Especialista em CFTV/segurança. Extraia: CÂMERAS (contar por tipo: dome/bullet/PTZ), CABOS (m por tipo: UTP Cat6/coaxial), ELETRODUTOS (m por ø), DVR/NVR (contar por canais), CATRACAS/TORNIQUETES (contar), LEITORES ACESSO (contar), RACKS (contar).
SINAPIs: Câmera dome:91960|Câmera bullet:91961|Câmera PTZ:91962|Cabo UTP Cat6:91970|Coaxial RG59:91971|Eletroduto 25mm:91911|32mm:91912|NVR 16ch:91975|Rack 12U:91980|Patch panel:91981
${BASE}`,

"Dados e Voz":`Especialista em cabeamento estruturado (NBR 14565). Extraia: PONTOS REDE (contar RJ45 por ambiente), CABOS UTP (m por categoria), ELETRODUTOS (m por ø), BANDEJAS (m por tamanho), PATCH PANELS (contar), SWITCHES (contar), RACKS (contar), FIBRA ÓPTICA (m backbone).
SINAPIs: Cabo Cat6:91970|Cat6A:91973|Fibra:91972|Eletroduto 25mm:91911|Bandeja 100x50:91935|Patch panel 24p:91981|Switch 24p:91982|Rack 24U:91983|Tomada RJ45:91984
${BASE}`,

"SPDA":`Especialista em SPDA e aterramento (NBR 5419 / ABNT NBR IEC 62305).

TIPO DE PRANCHA:
▶ PLANTA BAIXA: extraia aqui o sistema completo de aterramento e SPDA
▶ DETALHES: NÃO extraia quantidade — mostra método de instalação de um elemento típico

COMO MEDIR:
- MALHA DE ATERRAMENTO (strap/fita): meça comprimento total das linhas da malha na planta. Para malha em grelha: some comprimentos nas duas direções. Seção usual: 70×10mm ou 50×10mm em cobre ou aço galvanizado. Unidade: metros lineares.
- CAPTORES (Franklin/ESE/gaiola): conte os símbolos de captor em cobertura/platibanda. Captores em extremidades e cumeeiras.
- DESCIDAS (down conductor): conte quantos percursos verticais existem da cobertura até a haste. Altura = altura do edifício.
- HASTES DE ATERRAMENTO: normalmente 1 a 3 por descida. Comprimento: 2,4m ou 3,0m cada.
- CAIXAS DE INSPEÇÃO SPDA: 1 por descida a ~0,5m do solo. Contar unidades.
- DPS (dispositivo proteção surto): nos quadros elétricos — contar por classe (I, II, III). Localização no diagrama unifilar.

EXEMPLO F15 (depósito industrial): Edifício 43,8×18,8m → malha 70×10mm aço: ~(43,8+18,8)×2 = 125m perímetro + malha interna ≈ 200m total. Hastes: ~8 hastes de 3m. Descidas: ~8 descidas.

SINAPIs: Haste aterramento cobre 5/8"×3m:91960|Fita cobre nu 50mm²:91967|Fita cobre nu 70mm²:91968|Cx inspeção SPDA:91962|Captor Franklin:91963|DPS classe II:91965|Eletroduto SPDA:91966
${BASE}`,

"Especificação":`Especialista em especificações técnicas de materiais e equipamentos industriais.

ATENÇÃO: Documentos de especificação (IA = Instrumentação e Automação, EQ = Equipamentos) descrevem o QUE instalar, não o QUANTO existe. Para quantidades, veja a planta baixa correspondente.

SE FOR PLANTA DE INSTRUMENTAÇÃO (IA):
- Conte equipamentos pelo TAG: cada TAG único = 1 equipamento (ex: AM-15-0001 = 1 acionador manual)
- Tipos comuns: AM = acionador manual, JT = notificador A/V, DT = detector, SB = botão supressão
- Eletrodutos: meça comprimento dos percursos de dutos indicados na planta (em metros lineares)
- Central de alarme: 1 unidade por edifício

Para itens de processo sem SINAPI, use código da família mais próxima ou deixe sinapi_sugerido vazio.
SINAPIs: Acionador manual:74322|Notificador AV:74324|Detector chama:74321|Central alarme incêndio:74323|Eletroduto 3/4":91914|Tubo aço carbono 1":74156|2":74157|4":74159|Válvula esfera:74163|Bomba centrífuga:98300
${BASE}`,

"Gás Industrial":`Especialista em gás industrial/processo (NBR 15526). Extraia: TUBULAÇÕES (m por ø e material: aço carbono/cobre/PEAD), VÁLVULAS (contar por tipo e ø), SUPORTES (a cada 1,5m para ø≤2"), INSTRUMENTAÇÃO (contar manômetros/transmissores), EQUIPAMENTOS (reguladores/filtros — contar), ISOLAMENTO (m com isolamento).
SINAPIs: Aço carbono 1":74156|2":74157|3":74158|4":74159|6":74160|Cobre 15mm:74161|28mm:74162|Válvula esfera inox 1":74163|2":74164|Suporte sela:74165|Isolamento:74166|Regulador pressão:74203
${BASE}`,

"EstruturaMet":`ATENÇÃO: Esta prancha é de ESTRUTURA METÁLICA (ST = Steel Structure).
Na maioria das obras industriais BYD/automotivas, a estrutura metálica (terças, treliças, perfis de aço, cobertura metálica) é executada por empresa especializada SEPARADA do escopo da obra civil/concreto.

VERIFIQUE O ESCOPO DA OBRA antes de extrair:
- Se "Estrutura metálica" está listado como item FORA DO ESCOPO → retorne JSON com itens=[] e alerta explicando.
- Se está DENTRO do escopo → extraia: perfis de aço (kg por perfil: W, U, tubo, cantoneira), terças (m por perfil), parafusos (contar), chapas de ligação (m² de chapa), pintura anticorrosiva (m²).

SINAPIs: Estrutura metálica fornec.+mont.:98210|Perfil W aço:94100|Perfil U:94101|Terça Z:94102|Parafuso A325:94105|Chapa de ligação:94106|Pintura epoxi:87880
${BASE}`,
};

function getPrompt(d, obraCtx = "", fileName = "") {
  const tipoPranchaAviso = avisoTipoPrancha(fileName);
  const base = PROMPTS[d] || `Especialista em engenharia civil brasileira. Extraia todos os quantitativos pelas cotas e símbolos visíveis. Sugira código SINAPI Bahia para cada item. ${BASE}`;
  const partes = [];
  if (tipoPranchaAviso) partes.push(tipoPranchaAviso);
  if (obraCtx) partes.push(obraCtx);
  partes.push(base);
  return partes.join("\n\n");
}

// Prompt especializado para dados DXF (texto estruturado, não imagem)
function getDxfPrompt(disciplina, obraCtx, dxfData) {
  const { layers, blocos, textos, dimensoes, resumo } = dxfData;

  const layersSummary = Object.entries(layers)
    .map(([nome, L]) => {
      const partes = [`Layer "${nome}": ${L.contagem} entidades (${L.tipos.join(",")})`];
      if (L.comprimento > 0.01) partes.push(`compr.=${L.comprimento}m`);
      if (L.area > 0.01)        partes.push(`área=${L.area}m²`);
      if (Object.keys(L.blocos).length > 0) partes.push(`blocos: ${Object.entries(L.blocos).map(([k,v])=>`${k}×${v}`).join(", ")}`);
      if (L.textos.length > 0)  partes.push(`textos: "${L.textos.slice(0,5).join('", "')}"`);
      return partes.join(" | ");
    })
    .join("\n");

  const blocosSummary = Object.entries(blocos)
    .slice(0, 30)
    .map(([nome, b]) => `  ${nome}: ${b.contagem}× (layers: ${Object.keys(b.layers).join(",")})`)
    .join("\n");

  const textosSample = textos.slice(0, 40).map(t => `  [${t.layer}] "${t.texto}"`).join("\n");

  const dimSample = dimensoes.slice(0, 20).map(d => `  ${d.valor_m.toFixed(3)}m (layer: ${d.layer})`).join("\n");

  const discPrompt = PROMPTS[disciplina] || `Especialista em engenharia civil. Identifique os elementos construtivos e extraia quantidades. ${BASE}`;

  return `${obraCtx ? obraCtx + "\n\n" : ""}FONTE DE DADOS: ARQUIVO DXF do AutoCAD — dados geométricos EXATOS, não estimados.
Os valores de comprimento e área foram calculados matematicamente a partir das coordenadas reais do desenho CAD.
Unidade detectada: ${resumo.unidade_detectada} → todos os valores já convertidos para metros e m².
${resumo.escala ? `Escala declarada no arquivo: ${resumo.escala}` : ""}

RESUMO DO ARQUIVO:
- ${resumo.total_layers} layers com dados
- Comprimento total acumulado: ${resumo.total_comprimento_m}m
- Área total acumulada: ${resumo.total_area_m2}m²
- Total de blocos/símbolos inseridos: ${resumo.total_blocos}

LAYERS E MEDIÇÕES:
${layersSummary}

BLOCOS (símbolos inseridos — cada ocorrência = 1 elemento):
${blocosSummary || "  (nenhum bloco)"}

TEXTOS/ANOTAÇÕES ENCONTRADOS:
${textosSample || "  (nenhum)"}

DIMENSÕES EXPLÍCITAS:
${dimSample || "  (nenhuma)"}

${discPrompt}

INSTRUÇÕES ESPECIAIS PARA DXF:
- Os valores de comprimento/área acima são EXATOS — use-os diretamente sem converter
- Para cada layer, identifique a que elemento construtivo corresponde pelo nome do layer
- Layers com padrões como PILAR, PIL, P_EST, KZ → pilares
- Layers VIGA, VIG, V_EST, VSP → vigas
- Layers PAREDE, PAR, ALV, BLK → alvenaria
- Layers PISO, LAJE, LAJ, SLB → laje/piso
- Layers PORTA, P01, JNL, JANELA → esquadrias
- Layers ELET, ILUM, QDR, CRC → elétrica
- Layers TUBO, HID, ESG, AGF → hidrossanitária
- Blocos com contagem = quantidade exata daquele elemento
- Se um layer tem comprimento E área, o comprimento é o perímetro e a área é a superfície

Retorne JSON com as quantidades EXATAS dos dados acima. A confiança deve ser "alta" para todos os itens baseados em dados DXF.`;
}

// Fatores de preço SINAPI por categoria (% do SINAPI Bahia)
// Categorias mapeadas para grupo de SINAPI codes
const CATEGORIAS_SINAPI = {
  "Concreto (FCK)":          { desc: "FCK20/25/30/35 bombeado e convencional", default: 65 },
  "Formas / Cimbramento":    { desc: "Compensado, metálica, sistema pontalete", default: 80 },
  "Escavação / Terraplanagem":{ desc: "Manual e mecanizada, compactação", default: 85 },
  "Alvenaria / Vedação":     { desc: "Blocos cerâmico, concreto, cimentício, drywall", default: 82 },
  "Revestimento / Pintura":  { desc: "Reboco, cerâmica, porcelanato, tinta", default: 80 },
  "Cobertura / Impermeabilização":{ desc: "Telhas, manta, membrana, calha", default: 78 },
  "Elétrica / SPDA / CFTV":  { desc: "Eletrodutos, cabos, luminárias, QDC, CFTV", default: 88 },
  "Hidrossanitária / Pluvial":{ desc: "Tubos, conexões, louças, caixas", default: 85 },
  "Incêndio / HVAC":         { desc: "Sprinkler, detectores, splits, dutos", default: 90 },
  "Esquadrias (portas/janelas)":{ desc: "Alumínio, aço, madeira, vidro", default: 85 },
  "Pavimentação / Piso industrial":{ desc: "Concreto polido, epóxi, antiestático", default: 75 },
  "Mão de obra (MO)":        { desc: "Pedreiro, servente, eletricista — hora", default: 92 },
};

function aplicarFatorCategoria(descricao, precoSinapi, fatoresCategorias) {
  if (!precoSinapi || !fatoresCategorias) return precoSinapi;
  const dn = (descricao || "").toLowerCase();
  for (const [cat, { default: df }] of Object.entries(CATEGORIAS_SINAPI)) {
    const fator = (fatoresCategorias[cat] ?? df) / 100;
    // Match heurístico por palavra-chave
    if ((cat.includes("Concreto") && (dn.includes("concreto") || dn.includes("fck"))) ||
        (cat.includes("Formas") && (dn.includes("form") || dn.includes("cimbr"))) ||
        (cat.includes("Escavação") && (dn.includes("escava") || dn.includes("terrapl"))) ||
        (cat.includes("Alvenaria") && (dn.includes("alven") || dn.includes("bloco") || dn.includes("dry"))) ||
        (cat.includes("Revestimento") && (dn.includes("reboc") || dn.includes("ceràm") || dn.includes("porcela") || dn.includes("pint") || dn.includes("revestim"))) ||
        (cat.includes("Cobertura") && (dn.includes("cobert") || dn.includes("telh") || dn.includes("imperm") || dn.includes("manta") || dn.includes("calha"))) ||
        (cat.includes("Elétrica") && (dn.includes("eletr") || dn.includes("luminár") || dn.includes("cabo") || dn.includes("eletrod") || dn.includes("spda") || dn.includes("cftv"))) ||
        (cat.includes("Hidrossanitária") && (dn.includes("hid") || dn.includes("tubo") || dn.includes("esgoto") || dn.includes("pluvial") || dn.includes("drena"))) ||
        (cat.includes("Incêndio") && (dn.includes("incêndio") || dn.includes("sprink") || dn.includes("hvac") || dn.includes("split") || dn.includes("duto"))) ||
        (cat.includes("Esquadrias") && (dn.includes("porta") || dn.includes("janela") || dn.includes("esquadr"))) ||
        (cat.includes("Pavimentação") && (dn.includes("piso") || dn.includes("pavim") || dn.includes("epóxi") || dn.includes("polido"))) ||
        (cat.includes("Mão de obra") && (dn.includes("mão de obra") || dn.includes("servente") || dn.includes("pedreiro") || dn.includes("oficial")))) {
      return precoSinapi * fator;
    }
  }
  return precoSinapi * ((fatoresCategorias["Revestimento / Pintura"] ?? 80) / 100); // fallback genérico
}

// Monta contexto da obra para injetar no prompt
function montarObraCtx(obra, plantasExistentes) {
  const partes = [];
  if (obra.tipo_obra || obra.padrao) {
    partes.push(`CONTEXTO DA OBRA: ${[obra.nome, obra.tipo_obra, obra.padrao ? `padrão ${obra.padrao}` : ""].filter(Boolean).join(" · ")}`);
    if (obra.descricao) partes.push(`Descrição: ${obra.descricao}`);
  }
  if (plantasExistentes.length > 0) {
    const exemplos = plantasExistentes
      .flatMap(p => (p.itens || []).slice(0, 3).map(i => `  - ${i.descricao} (${i.qtd} ${i.un})`))
      .slice(0, 10);
    if (exemplos.length > 0) {
      partes.push(`EXEMPLOS DE ITENS JÁ EXTRAÍDOS NESTA OBRA (use como referência de escala e padrão):\n${exemplos.join("\n")}`);
    }
  }
  // Escopo da empresa — itens a excluir
  const excluir = (obra.escopo_excluir || []).filter(Boolean);
  if (excluir.length > 0) {
    partes.push(`ITENS FORA DO ESCOPO DESTA EMPRESA — NÃO EXTRAIA:\n${excluir.map(e=>`  - ${e}`).join("\n")}\nSe aparecerem no desenho, ignore completamente. Eles são executados por terceiros.`);
  }

  // Lições aprendidas de erros anteriores corrigidos pela IA
  const licoes = getLicoes();
  if (licoes.length > 0) {
    const top = licoes.slice(0, 12).map(l => `  ⚠ ${l.padrao} → ${l.correcao}`).join("\n");
    partes.push(`ERROS APRENDIDOS — EVITE REPETIR:\n${top}`);
  }
  return partes.join("\n");
}

// Verifica consistência estrutural: ratio aço/concreto
function checaConsistencia(itens, disciplina) {
  if (disciplina !== "Estrutura") return null;
  const descNorm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const concreto = itens.filter(i => descNorm(i.descricao).includes("concreto") && i.un === "m³");
  const aco      = itens.filter(i => (descNorm(i.descricao).includes("aco") || descNorm(i.descricao).includes("armacao")) && i.un === "kg");
  const totalC   = concreto.reduce((s, i) => s + (i.qtd || 0), 0);
  const totalA   = aco.reduce((s, i) => s + (i.qtd || 0), 0);
  if (totalC < 0.01 || totalA < 0.01) return null;
  const ratio = totalA / totalC;
  if (ratio < 50)  return { tipo: "aviso", ratio, msg: `Ratio aço/concreto = ${ratio.toFixed(0)} kg/m³ — abaixo do esperado (80–350 kg/m³). Verifique se toda armação foi extraída.` };
  if (ratio > 400) return { tipo: "aviso", ratio, msg: `Ratio aço/concreto = ${ratio.toFixed(0)} kg/m³ — acima do esperado (80–350 kg/m³). Possível duplicação de quantitativo.` };
  return { tipo: "ok", ratio, msg: `Ratio aço/concreto = ${ratio.toFixed(0)} kg/m³ — dentro da faixa esperada (80–350 kg/m³).` };
}

// ─── DEDUPLICAÇÃO PÓS-EXTRAÇÃO ───────────────────────────────────────────────
function normStr(s) {
  return String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g," ").replace(/\s+/g," ").trim();
}

function deduplicarItens(itens) {
  const CONF_PESO = { alta:0, media:1, baixa:2 };
  const mapa = new Map();

  for (const it of itens) {
    // Chave: primeiros 45 chars da desc normalizada + unidade + localização normalizada
    const chave = `${normStr(it.descricao).slice(0,45)}|${(it.un||"").toLowerCase()}|${normStr(it.localizacao||"")}`;

    if (!mapa.has(chave)) {
      mapa.set(chave, { ...it, _dupCount: 1 });
    } else {
      const ex = mapa.get(chave);
      const pesoEx  = CONF_PESO[ex.confianca||"media"] ?? 1;
      const pesoNew = CONF_PESO[it.confianca||"media"] ?? 1;
      // Mantém o de maior confiança; se igual, mantém o primeiro (evita soma acidental)
      if (pesoNew < pesoEx) {
        mapa.set(chave, { ...it, _dupCount: ex._dupCount + 1 });
      } else {
        ex._dupCount += 1;
      }
    }
  }

  const resultado = [...mapa.values()];
  const nDup = itens.length - resultado.length;
  if (nDup > 0) console.log(`[Dedup] ${nDup} itens duplicados removidos (${itens.length} → ${resultado.length})`);
  return resultado;
}

// ─── ESCOPO — verifica se item está fora do escopo da empresa ────────────────
function itemForaDoEscopo(item, excluirKeywords) {
  if (!excluirKeywords?.length) return false;
  const texto = normStr(`${item.descricao} ${item.sinapi_descricao||""} ${item.mat_descricao||""}`);
  return excluirKeywords.some(kw => kw.trim() && texto.includes(normStr(kw)));
}

// ─── LIÇÕES APRENDIDAS (localStorage) ────────────────────────────────────────
function getLicoes() {
  try { return JSON.parse(localStorage.getItem("qt_licoes") || "[]"); } catch { return []; }
}
function salvarLicoes(novas) {
  const atuais = getLicoes();
  const merged = [...novas.map(l => ({ ...l, criadoEm: new Date().toISOString() })), ...atuais];
  const dedup  = merged.filter((l, i) => !merged.slice(0, i).some(x => x.padrao === l.padrao));
  localStorage.setItem("qt_licoes", JSON.stringify(dedup.slice(0, 30)));
}

// Valida compatibilidade de unidade entre item e SINAPI
function unCompativel(unItem, unSinapi) {
  if (!unItem || !unSinapi) return null;
  const n = s => s.toLowerCase().replace(/[²³]/g, c => c === "²" ? "2" : "3").replace(/\s/g, "");
  const a = n(unItem), b = n(unSinapi);
  if (a === b) return true;
  const GRUPOS = [["m2","m²"],["m3","m³"],["kg","kgf"],["un","unid","und","cj","pç"],["h","hr","hora"],["l","litro","lt"],["m","ml","m1"]];
  for (const g of GRUPOS) { if (g.includes(a) && g.includes(b)) return true; }
  return false;
}

// ─── CORES ────────────────────────────────────────────────────────────────────
const DISC_COR = {
  "Arquitetura":    {bg:"#dbeafe",text:"#1e40af",border:"#93c5fd"},
  "Estrutura":      {bg:"#ede9fe",text:"#5b21b6",border:"#c4b5fd"},
  "Elétrica":       {bg:"#fef3c7",text:"#92400e",border:"#fcd34d"},
  "Hidrossanitária":{bg:"#dcfce7",text:"#166534",border:"#86efac"},
  "Pluvial":        {bg:"#d1fae5",text:"#065f46",border:"#6ee7b7"},
  "Incêndio":       {bg:"#fee2e2",text:"#991b1b",border:"#fca5a5"},
  "HVAC":           {bg:"#e0f2fe",text:"#0c4a6e",border:"#7dd3fc"},
  "CFTV":           {bg:"#f3e8ff",text:"#6b21a8",border:"#d8b4fe"},
  "Dados e Voz":    {bg:"#fce7f3",text:"#9d174d",border:"#f9a8d4"},
  "SPDA":           {bg:"#fff7ed",text:"#9a3412",border:"#fdba74"},
  "Gás Industrial": {bg:"#f0fdf4",text:"#14532d",border:"#86efac"},
  "EstruturaMet":   {bg:"#f1f5f9",text:"#475569",border:"#94a3b8"},
  "Especificação":  {bg:"#fdf4ff",text:"#7e22ce",border:"#e879f9"},
};
const FONTE_COR = {
  "📐 Cota":       {bg:"#dbeafe",color:"#1e40af"},
  "🔢 Contagem":   {bg:"#dcfce7",color:"#166534"},
  "🧮 Cálculo":    {bg:"#ede9fe",color:"#5b21b6"},
  "🔍 Inferência": {bg:"#fef3c7",color:"#92400e"},
};
const S = {
  card:       {background:"#fff",border:"1px solid #e5e7eb",borderRadius:12},
  input:      {width:"100%",padding:"8px 12px",border:"1px solid #d1d5db",borderRadius:8,fontSize:13,outline:"none",boxSizing:"border-box"},
  btn:        {padding:"8px 16px",border:"1px solid #d1d5db",borderRadius:8,background:"#fff",cursor:"pointer",fontSize:13,fontWeight:500},
  btnPrimary: {padding:"8px 16px",border:"none",borderRadius:8,background:"#111",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:500},
  th:         {padding:"8px 10px",textAlign:"left",fontWeight:600,color:"#6b7280",fontSize:11,borderBottom:"1px solid #e5e7eb",background:"#f9fafb",whiteSpace:"nowrap"},
  td:         {padding:"8px 10px",fontSize:12,borderBottom:"1px solid #f3f4f6",verticalAlign:"top"},
  label:      {fontSize:12,fontWeight:500,color:"#374151",display:"block",marginBottom:4},
};
const uid  = () => Math.random().toString(36).slice(2,9);
const fmt  = (n) => typeof n==="number"?n.toLocaleString("pt-BR",{maximumFractionDigits:2}):(n||"—");
const fmtR = (n) => n?.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})||"—";
const toB64 = (f) => new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function QuantitativoApp() {
  const [secao,setSecao]         = useState("obras");
  const [clientes,setClientes] = useState([]);
  const [obras,setObras]       = useState([]);
  const [sinapiRef,setSinapiRef] = useState(null);
  const iniciado = useRef(false);

  // Carrega do localStorage só no cliente (fix SSR)
  useEffect(()=>{
    try {
      const c = localStorage.getItem("qt_clientes");
      const o = localStorage.getItem("qt_obras");
      if(c) setClientes(JSON.parse(c));
      if(o) setObras(JSON.parse(o));
    } catch(e){}
    iniciado.current = true;
  },[]);

  // Só salva depois de ter carregado (evita sobrescrever com [])
  useEffect(()=>{ if(iniciado.current) localStorage.setItem("qt_clientes",JSON.stringify(clientes)); },[clientes]);
  useEffect(()=>{ if(iniciado.current) localStorage.setItem("qt_obras",JSON.stringify(obras)); },[obras]);
  useEffect(()=>{fetch("/api/sinapi?q=").then(r=>r.json()).then(d=>{if(d.referencia)setSinapiRef(d.referencia);}).catch(()=>{});},[]);

  const totalPlanta = obras.reduce((s,o)=>s+(o.plantas?.length||0),0);
  const totalItens  = obras.reduce((s,o)=>s+(o.plantas||[]).reduce((ss,p)=>ss+(p.itens?.length||0),0),0);

  return (
    <div style={{display:"flex",minHeight:"100vh",fontFamily:"system-ui,sans-serif",background:"#f9fafb"}}>
      <div style={{width:220,background:"#111",color:"#fff",padding:"24px 0",display:"flex",flexDirection:"column",flexShrink:0,position:"sticky",top:0,height:"100vh"}}>
        <div style={{padding:"0 20px 20px",borderBottom:"1px solid #222"}}>
          <div style={{fontSize:15,fontWeight:800,marginBottom:2}}>Quantitativos IA</div>
          <div style={{fontSize:11,color:"#6b7280"}}>Medição · Orçamento · SINAPI</div>
          {sinapiRef&&<div style={{fontSize:10,color:"#22c55e",marginTop:4}}>● SINAPI BA {sinapiRef}</div>}
        </div>
        <div style={{padding:"12px 0"}}>
          {[{id:"obras",label:"Obras",icon:"🏗️"},{id:"clientes",label:"Clientes",icon:"🏢"},{id:"sinapi",label:"SINAPI Bahia",icon:"📋"},{id:"orcamento",label:"Orçamento",icon:"💰"}].map(item=>(
            <button key={item.id} onClick={()=>setSecao(item.id)} style={{width:"100%",textAlign:"left",padding:"10px 20px",border:"none",cursor:"pointer",background:secao===item.id?"rgba(255,255,255,0.1)":"transparent",color:secao===item.id?"#fff":"#9ca3af",fontSize:13,fontWeight:secao===item.id?600:400,borderLeft:`3px solid ${secao===item.id?"#fff":"transparent"}`}}>{item.icon} {item.label}</button>
          ))}
        </div>
        <div style={{marginTop:"auto",padding:"16px 20px",borderTop:"1px solid #222",fontSize:11,color:"#6b7280"}}>
          <div>{clientes.length} cliente{clientes.length!==1?"s":""}</div>
          <div>{obras.length} obra{obras.length!==1?"s":""} · {totalPlanta} planta{totalPlanta!==1?"s":""}</div>
          <div>{totalItens} itens extraídos</div>
        </div>
      </div>
      <div style={{flex:1,padding:"32px 36px",overflowX:"auto",minWidth:0}}>
        {secao==="clientes"  && <SecaoClientes clientes={clientes} setClientes={setClientes} obras={obras}/>}
        {secao==="obras"     && <SecaoObras obras={obras} setObras={setObras} clientes={clientes}/>}
        {secao==="sinapi"    && <SecaoSinapi/>}
        {secao==="orcamento" && <SecaoOrcamento obras={obras}/>}
      </div>
    </div>
  );
}

// ─── CLIENTES ─────────────────────────────────────────────────────────────────
function SecaoClientes({clientes,setClientes,obras}) {
  const [form,setForm]   = useState({nome:"",tipo:"",contato:""});
  const [editId,setEditId] = useState(null);
  const salvar=()=>{
    if(!form.nome.trim())return;
    if(editId){setClientes(p=>p.map(c=>c.id===editId?{...c,...form}:c));setEditId(null);}
    else setClientes(p=>[...p,{id:uid(),...form,criadoEm:new Date().toLocaleDateString("pt-BR")}]);
    setForm({nome:"",tipo:"",contato:""});
  };
  return (
    <div>
      <h1 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Clientes</h1>
      <p style={{fontSize:13,color:"#6b7280",marginBottom:24}}>Cadastre clientes e vincule obras.</p>
      <div style={{...S.card,padding:20,marginBottom:24}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:10,alignItems:"end"}}>
          <div><label style={S.label}>Nome *</label><input style={S.input} value={form.nome} onChange={e=>setForm(p=>({...p,nome:e.target.value}))} placeholder="BYD do Brasil"/></div>
          <div><label style={S.label}>Tipo</label><input style={S.input} value={form.tipo} onChange={e=>setForm(p=>({...p,tipo:e.target.value}))} placeholder="Industrial, Portuário..."/></div>
          <div><label style={S.label}>Contato</label><input style={S.input} value={form.contato} onChange={e=>setForm(p=>({...p,contato:e.target.value}))} placeholder="Email ou telefone"/></div>
          <button onClick={salvar} style={S.btnPrimary}>{editId?"Salvar":"Adicionar"}</button>
        </div>
        {editId&&<button onClick={()=>{setEditId(null);setForm({nome:"",tipo:"",contato:""}); }} style={{...S.btn,marginTop:8,fontSize:12}}>Cancelar</button>}
      </div>
      {clientes.length===0?(
        <div style={{textAlign:"center",padding:"60px 0",color:"#9ca3af"}}><div style={{fontSize:36,marginBottom:8}}>🏢</div><div>Nenhum cliente ainda.</div></div>
      ):(
        <div style={{...S.card,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Cliente","Tipo","Contato","Obras","Cadastrado",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{clientes.map(c=>(
              <tr key={c.id}>
                <td style={{...S.td,fontWeight:600}}>{c.nome}</td>
                <td style={S.td}><span style={{fontSize:11,padding:"2px 8px",borderRadius:20,background:"#f3f4f6"}}>{c.tipo||"—"}</span></td>
                <td style={{...S.td,color:"#6b7280"}}>{c.contato||"—"}</td>
                <td style={{...S.td,textAlign:"center"}}>{obras.filter(o=>o.clienteId===c.id).length}</td>
                <td style={{...S.td,color:"#9ca3af"}}>{c.criadoEm}</td>
                <td style={S.td}>
                  <button onClick={()=>{setForm({nome:c.nome,tipo:c.tipo,contato:c.contato});setEditId(c.id);}} style={{...S.btn,fontSize:11,padding:"4px 10px",marginRight:4}}>Editar</button>
                  <button onClick={()=>{if(confirm("Excluir?"))setClientes(p=>p.filter(x=>x.id!==c.id));}} style={{...S.btn,fontSize:11,padding:"4px 10px",color:"#dc2626",borderColor:"#fecaca"}}>Excluir</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── OBRAS ────────────────────────────────────────────────────────────────────
function SecaoObras({obras,setObras,clientes}) {
  const [obraAtiva,setObraAtiva]     = useState(null);
  const [plantaAtiva,setPlantaAtiva] = useState(null);
  const [showForm,setShowForm]       = useState(false);
  const [filtro,setFiltro]           = useState("todos");
  const [form,setForm]               = useState({nome:"",clienteId:"",descricao:"",tipo_obra:"",padrao:"",escopo_excluir:[],fator_mercado:100,fatores_categorias:{}});
  const [showFatores,setShowFatores] = useState(false);

  const criar=()=>{
    if(!form.nome.trim())return;
    const nova={id:uid(),...form,criadoEm:new Date().toLocaleDateString("pt-BR"),plantas:[]};
    setObras(p=>[...p,nova]);setForm({nome:"",clienteId:"",descricao:"",tipo_obra:"",padrao:"",escopo_excluir:[]});setShowForm(false);setObraAtiva(nova.id);
  };

  const obra   = obras.find(o=>o.id===obraAtiva);
  const planta = obra?.plantas?.find(p=>p.id===plantaAtiva);

  if(obra&&planta) return <VisualizadorPlanta planta={planta} obra={obra} onBack={()=>setPlantaAtiva(null)} obras={obras} setObras={setObras} key={planta.id}/>;
  if(obra)         return <DetalhesObra obra={obra} obras={obras} setObras={setObras} clientes={clientes} onBack={()=>{setObraAtiva(null);setPlantaAtiva(null);}} onOpenPlanta={setPlantaAtiva}/>;

  const obrasFiltradas = filtro==="todos"?obras:obras.filter(o=>o.clienteId===filtro);

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Obras</h1>
          <p style={{fontSize:13,color:"#6b7280"}}>Carregue todas as plantas e clique em <strong>Orçar</strong> — a IA processa tudo de uma vez.</p>
        </div>
        <button onClick={()=>setShowForm(true)} style={S.btnPrimary}>+ Nova obra</button>
      </div>

      {showForm&&(
        <div style={{...S.card,padding:20,marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>Nova obra</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div><label style={S.label}>Nome *</label><input style={S.input} value={form.nome} onChange={e=>setForm(p=>({...p,nome:e.target.value}))} placeholder="Fábrica BYD — Bloco A"/></div>
            <div><label style={S.label}>Cliente</label>
              <select style={S.input} value={form.clienteId} onChange={e=>setForm(p=>({...p,clienteId:e.target.value}))}>
                <option value="">Sem cliente</option>
                {clientes.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div><label style={S.label}>Tipo de obra</label>
              <select style={S.input} value={form.tipo_obra} onChange={e=>setForm(p=>({...p,tipo_obra:e.target.value}))}>
                <option value="">Selecione (opcional)</option>
                {["Industrial","Comercial","Residencial","Institucional/Público","Infraestrutura","Logística","Saúde","Educação"].map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label style={S.label}>Padrão construtivo</label>
              <select style={S.input} value={form.padrao} onChange={e=>setForm(p=>({...p,padrao:e.target.value}))}>
                <option value="">Selecione (opcional)</option>
                {["Simples","Médio","Alto","Premium"].map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{marginBottom:12}}><label style={S.label}>Descrição</label><input style={S.input} value={form.descricao} onChange={e=>setForm(p=>({...p,descricao:e.target.value}))} placeholder="Localização, contrato..."/></div>
          <div style={{marginBottom:12}}>
            <label style={S.label}>Preços de mercado (% do SINAPI)</label>
            <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"10px 14px"}}>
              <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:12,color:"#374151",flex:1}}>Fator geral (fallback quando categoria não mapeada)</span>
                <input type="number" min={40} max={100} value={form.fator_mercado||100} onChange={e=>setForm(p=>({...p,fator_mercado:Number(e.target.value)}))} style={{...S.input,width:64,textAlign:"center",fontSize:13}}/>
                <span style={{fontSize:12,color:"#6b7280"}}>% SINAPI</span>
              </div>
              <button type="button" onClick={()=>setShowFatores(v=>!v)} style={{...S.btn,fontSize:11,padding:"3px 10px",marginBottom:showFatores?8:0}}>
                {showFatores?"▲ Ocultar":"▼ Configurar por categoria"}
              </button>
              {showFatores&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:6}}>
                  {Object.entries(CATEGORIAS_SINAPI).map(([cat,{desc,default:df}])=>{
                    const val = form.fatores_categorias?.[cat] ?? df;
                    return (
                      <div key={cat} style={{display:"flex",gap:6,alignItems:"center",background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,padding:"5px 8px"}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:11,fontWeight:500,color:"#374151",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cat}</div>
                          <div style={{fontSize:10,color:"#9ca3af",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{desc}</div>
                        </div>
                        <input type="number" min={40} max={100} value={val}
                          onChange={e=>setForm(p=>({...p,fatores_categorias:{...p.fatores_categorias,[cat]:Number(e.target.value)}}))}
                          style={{width:50,padding:"3px 6px",border:"1px solid #d1d5db",borderRadius:5,fontSize:12,textAlign:"center"}}/>
                        <span style={{fontSize:10,color:"#9ca3af"}}>%</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{fontSize:11,color:"#9ca3af",marginTop:6}}>Industrial BYD: Concreto 65% · Formas 80% · Elétrica 88%. Comercial/Residencial: valores mais próximos de 85–95%.</div>
            </div>
          </div>
          <div style={{marginBottom:12}}>
            <label style={S.label}>Itens fora do escopo da empresa (executados por terceiros)</label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
              {["Aço de armadura / CA-50 / CA-60","Estrutura metálica","Estacas / Fundações especiais","Instalações hidrossanitárias","Instalações elétricas AT","HVAC / Climatização","Impermeabilização"].map(op=>{
                const sel = (form.escopo_excluir||[]).includes(op);
                return <button key={op} type="button" onClick={()=>setForm(p=>({...p,escopo_excluir:sel?p.escopo_excluir.filter(x=>x!==op):[...(p.escopo_excluir||[]),op]}))}
                  style={{fontSize:11,padding:"4px 10px",borderRadius:20,border:`1px solid ${sel?"#dc2626":"#d1d5db"}`,background:sel?"#fee2e2":"#fff",color:sel?"#dc2626":"#6b7280",cursor:"pointer"}}>{sel?"✕ ":""}{op}</button>;
              })}
            </div>
            <div style={{fontSize:11,color:"#9ca3af"}}>A IA não extrairá esses itens. Clique para selecionar/desselecionar.</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={criar} style={S.btnPrimary}>Criar</button>
            <button onClick={()=>setShowForm(false)} style={S.btn}>Cancelar</button>
          </div>
        </div>
      )}

      {clientes.length>0&&(
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          {[{id:"todos",nome:"Todos"},...clientes].map(c=>(
            <button key={c.id} onClick={()=>setFiltro(c.id)} style={{...S.btn,fontSize:12,background:filtro===c.id?"#111":"#fff",color:filtro===c.id?"#fff":"#374151",border:`1px solid ${filtro===c.id?"#111":"#d1d5db"}`}}>{c.nome}</button>
          ))}
        </div>
      )}

      {obrasFiltradas.length===0?(
        <div style={{textAlign:"center",padding:"60px 0",color:"#9ca3af"}}><div style={{fontSize:36,marginBottom:8}}>🏗️</div><div>Nenhuma obra ainda.</div></div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:16}}>
          {obrasFiltradas.map(o=>{
            const cliente=clientes.find(c=>c.id===o.clienteId);
            const nPlanta=o.plantas?.length||0;
            const nItens=(o.plantas||[]).reduce((s,p)=>s+(p.itens?.length||0),0);
            const discs=[...new Set((o.plantas||[]).map(p=>p.disciplina).filter(Boolean))];
            const totalOrc=(o.plantas||[]).reduce((s,p)=>(p.itens||[]).reduce((ss,i)=>ss+(i.preco_sinapi||0)*(i.qtd||0),s),0);
            return (
              <div key={o.id} onClick={()=>setObraAtiva(o.id)} style={{...S.card,padding:20,cursor:"pointer"}}
                onMouseOver={e=>e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,.08)"}
                onMouseOut={e=>e.currentTarget.style.boxShadow=""}>
                {cliente&&<div style={{fontSize:11,color:"#6b7280",marginBottom:4}}>{cliente.nome}</div>}
                <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>{o.nome}</div>
                {o.descricao&&<div style={{fontSize:12,color:"#6b7280",marginBottom:10}}>{o.descricao}</div>}
                {discs.length>0&&(
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:10}}>
                    {discs.map(d=>{const c=DISC_COR[d]||{};return(<span key={d} style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:c.bg||"#f3f4f6",color:c.text||"#374151",border:`1px solid ${c.border||"#e5e7eb"}`}}>{d}</span>);})}
                  </div>
                )}
                <div style={{display:"flex",gap:10,fontSize:12,color:"#9ca3af",flexWrap:"wrap"}}>
                  <span>📄 {nPlanta} planta{nPlanta!==1?"s":""}</span>
                  <span>📦 {nItens} itens</span>
                  {totalOrc>0&&<span style={{color:"#059669",fontWeight:600}}>{fmtR(totalOrc)}</span>}
                  <span style={{marginLeft:"auto"}}>{o.criadoEm}</span>
                </div>
                <button onClick={e=>{e.stopPropagation();if(confirm("Excluir obra?"))setObras(p=>p.filter(x=>x.id!==o.id));}} style={{marginTop:10,fontSize:11,color:"#dc2626",background:"none",border:"none",cursor:"pointer",padding:0}}>Excluir</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── DETALHES DA OBRA ─────────────────────────────────────────────────────────
function DetalhesObra({obra,obras,setObras,clientes,onBack,onOpenPlanta}) {
  // pendentes = arquivos carregados mas ainda não analisados
  const [pendentes,setPendentes]   = useState([]); // [{id,fileName,disciplina,imgs,status,progresso}]
  const [orcando,setOrcando]       = useState(false);
  const [dragOver,setDragOver]     = useState(false);
  const [erro,setErro]             = useState("");
  const [verificandoGeral,setVerificandoGeral] = useState(false);
  const [verificacaoGeral,setVerificacaoGeral] = useState(null);
  const [corrigindo,setCorrigindo]   = useState(false);
  const [correcoes,setCorrecoes]     = useState(null);  // preview antes de aplicar
  const [nAplicadas,setNAplicadas]   = useState(0);
  const fileRef   = useRef();
  const folderRef = useRef();
  const ultimaRequisicao = useRef(0);
  const cliente = clientes.find(c=>c.id===obra.clienteId);
  const atualizar = (fn)=>setObras(p=>p.map(o=>o.id===obra.id?fn(o):o));
  const obraAtual = obras.find(o=>o.id===obra.id);

  const verificarTodasPlantas = async () => {
    const todasPlantas = obraAtual?.plantas || [];
    if (!todasPlantas.length || verificandoGeral) return;
    setVerificandoGeral(true); setVerificacaoGeral(null);
    try {
      const resumo = todasPlantas.map(p => {
        const itensStr = (p.itens||[]).map(i =>
          `  ${i.codigo_item}: ${i.descricao} (${i.qtd} ${i.un}) conf:${i.confianca||"?"}`
        ).join("\n");
        return `[${p.disciplina||"??"} — ${p.fileName}]\n${itensStr||"  (sem itens)"}`;
      }).join("\n\n");
      const promptVerif = `Você é um orçamentista sênior revisando todos os quantitativos da obra "${obra.nome}".\n\nItens por planta:\n${resumo}\n\nAnalise e identifique:\n1. Quantidades fora da escala esperada para este tipo de obra\n2. Itens que parecem duplicados entre disciplinas\n3. Serviços que provavelmente estão faltando (ex: impermeabilização sem armação, elétrica sem aterramento)\n4. Inconsistências entre disciplinas (ex: área de piso diferente da área de forro)\n\nRetorne APENAS JSON: {"flags":[{"planta":"nome do arquivo","codigo_item":"XXX-001","problema":"descrição","sugestao":"ação sugerida","gravidade":"alta|media|baixa"}],"resumo_geral":"avaliação geral da consistência do orçamento"}`;
      const reqBody = JSON.stringify({model:"claude-sonnet-4-6",max_tokens:8192,system:promptVerif,
        messages:[{role:"user",content:[{type:"text",text:"Revise todos os quantitativos desta obra."}]}]});
      const resp = await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:reqBody});
      const data = await resp.json();
      const text = data.content?.find(b=>b.type==="text")?.text||"{}";
      const clean   = text.replace(/```json|```/g,"").trim();
      const jsonStr = clean.match(/\{[\s\S]*\}/)?.[0] || "{}";
      let json = { flags:[], resumo_geral:"" };
      try {
        json = JSON.parse(jsonStr);
      } catch {
        // JSON truncado — recupera flags parciais
        const flagsMatch = jsonStr.match(/"flags"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
        const resumoMatch = jsonStr.match(/"resumo_geral"\s*:\s*"([^"]*)"/);
        const items = [];
        if (flagsMatch?.[1]) {
          const re = /\{[^{}]*(?:"[^"]*"[^{}]*)*\}/g;
          let m;
          while ((m = re.exec(flagsMatch[1])) !== null) {
            try { items.push(JSON.parse(m[0])); } catch {}
          }
        }
        json.flags = items;
        json.resumo_geral = (resumoMatch?.[1] || "") + (items.length ? " (resposta parcialmente recuperada)" : "");
      }
      setVerificacaoGeral(json);
    } catch(e) {
      setVerificacaoGeral({flags:[],resumo_geral:`Erro: ${e.message}`});
    }
    setVerificandoGeral(false);
  };

  const corrigirComIA = async () => {
    if (!verificacaoGeral?.flags?.length || corrigindo) return;
    setCorrigindo(true); setCorrecoes(null);
    try {
      const todasPlantas = obraAtual?.plantas || [];
      // Monta contexto: itens flagados com seus dados atuais
      const itensFlagados = verificacaoGeral.flags.map(f => {
        const planta = todasPlantas.find(p => p.fileName === f.planta || p.disciplina === f.planta);
        const item   = planta?.itens?.find(i => i.codigo_item === f.codigo_item);
        return { ...f, item_atual: item ? { qtd: item.qtd, un: item.un, sinapi: item.sinapi_sugerido, descricao: item.descricao } : null };
      });

      const promptCorr = `Você revisou os quantitativos da obra "${obra.nome}" e identificou os seguintes problemas:\n\n${
        itensFlagados.map(f => `[${f.gravidade}] ${f.planta} / ${f.codigo_item||"?"}: ${f.problema}\n  Dado atual: ${JSON.stringify(f.item_atual)}\n  Sugestão anterior: ${f.sugestao||"—"}`).join("\n\n")
      }\n\nAgora gere as correções específicas e extraia as lições aprendidas para melhorar análises futuras.\n\nRetorne APENAS JSON:\n{"correcoes":[{"planta":"nome do arquivo exato","codigo_item":"XXX-001","campo":"qtd|sinapi_sugerido|un|descricao","valor_atual":"...","valor_novo":"...","justificativa":"por que corrigir"}],"licoes":[{"padrao":"padrão de erro a evitar nas próximas análises","correcao":"como extrair corretamente"}]}`;

      const reqBody = JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:8192,
        system: promptCorr, messages:[{role:"user",content:[{type:"text",text:"Gere as correções e lições aprendidas."}]}] });
      const resp = await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:reqBody});
      const data = await resp.json();
      const text = data.content?.find(b=>b.type==="text")?.text||"{}";
      const clean = text.replace(/```json|```/g,"").trim();
      const jsonStr = clean.match(/\{[\s\S]*\}/)?.[0] || "{}";
      let json = { correcoes:[], licoes:[] };
      try {
        json = JSON.parse(jsonStr);
      } catch {
        // JSON truncado — recupera arrays parciais válidos
        const corrMatch = jsonStr.match(/"correcoes"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
        const licMatch  = jsonStr.match(/"licoes"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
        const parseArr  = str => {
          if (!str) return [];
          const items = [];
          const re = /\{[^{}]*(?:"[^"]*"[^{}]*)*\}/g;
          let m;
          while ((m = re.exec(str)) !== null) {
            try { items.push(JSON.parse(m[0])); } catch {}
          }
          return items;
        };
        json.correcoes = parseArr(corrMatch?.[1]);
        json.licoes    = parseArr(licMatch?.[1]);
      }
      setCorrecoes(json);
    } catch(e) {
      setCorrecoes({ correcoes:[], licoes:[], erro: e.message });
    }
    setCorrigindo(false);
  };

  const aplicarCorrecoes = () => {
    if (!correcoes?.correcoes?.length) return;
    const todasPlantas = obraAtual?.plantas || [];
    let count = 0;
    atualizar(o => ({
      ...o,
      plantas: o.plantas.map(planta => {
        const corrsPlanta = correcoes.correcoes.filter(c => c.planta === planta.fileName);
        if (!corrsPlanta.length) return planta;
        return {
          ...planta,
          itens: planta.itens.map(item => {
            const corr = corrsPlanta.find(c => c.codigo_item === item.codigo_item);
            if (!corr) return item;
            count++;
            return { ...item, [corr.campo]: corr.valor_novo, corrigido_ia: true, corr_justificativa: corr.justificativa };
          }),
        };
      }),
    }));
    if (correcoes.licoes?.length) salvarLicoes(correcoes.licoes);
    setNAplicadas(count);
    setCorrecoes(null);
    setVerificacaoGeral(null);
  };

  // Renderiza PDF em alta resolução e divide em tiles para melhor leitura pelo Gemini
  // Plantas A1 (1:100-1:200) têm anotações muito pequenas — scale 3.0 garante legibilidade
  const pdfParaImagensTiles = async (file, onProgress) => {
    // Dynamic import do pdfjs-dist instalado (evita problemas SSR com Next.js)
    const pdfjsLib = await import("pdfjs-dist");
    // Worker via CDN correspondente à versão instalada
    const ver = pdfjsLib.version || "5.7.284";
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const tiles = [];
    const SCALE      = 3.0;   // 3× = ~216 DPI — cotas de plantas A1 ficam legíveis
    const TILE_MAX   = 3200;  // máx pixels por dimensão antes de dividir em tiles
    const OVERLAP    = 0.08;  // 8% de sobreposição entre tiles vizinhos

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      onProgress?.(`Renderizando página ${pageNum}/${pdf.numPages} em alta resolução...`);
      const page = await pdf.getPage(pageNum);
      const vp   = page.getViewport({ scale: SCALE });

      const canvas = document.createElement("canvas");
      canvas.width  = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;

      const W = canvas.width;
      const H = canvas.height;
      const cols = Math.min(2, Math.ceil(W / TILE_MAX)); // máx 2 colunas
      const rows = Math.min(2, Math.ceil(H / TILE_MAX)); // máx 2 linhas → máx 4 tiles/pág

      if (cols === 1 && rows === 1) {
        // Página pequena: envia inteira
        tiles.push({
          base64: canvas.toDataURL("image/jpeg", 0.93).split(",")[1],
          type: "image/jpeg",
          _tileLabel: `pág.${pageNum}`,
        });
      } else {
        // Divide em grid com sobreposição para não cortar elementos nas bordas
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const sx = Math.max(0, Math.floor(c * W / cols - W * OVERLAP / 2));
            const sy = Math.max(0, Math.floor(r * H / rows - H * OVERLAP / 2));
            const sw = Math.min(Math.ceil(W / cols * (1 + OVERLAP)), W - sx);
            const sh = Math.min(Math.ceil(H / rows * (1 + OVERLAP)), H - sy);
            const tc  = document.createElement("canvas");
            tc.width  = sw; tc.height = sh;
            tc.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
            tiles.push({
              base64: tc.toDataURL("image/jpeg", 0.93).split(",")[1],
              type: "image/jpeg",
              _tileLabel: `pág.${pageNum} seção ${r * cols + c + 1}/${rows * cols}`,
            });
          }
        }
      }
    }
    return tiles;
  };

  // Carregar arquivos (sem analisar ainda)
  const carregarArquivos = async(files)=>{
    setErro("");
    for(const file of Array.from(files)){
      const disc=detectarDisciplina(file.name);
      const id=uid();
      const isDXF = file.name.toLowerCase().endsWith(".dxf");
      setPendentes(p=>[...p,{id,fileName:file.name,disciplina:disc,imgs:null,dxfData:null,status:"carregando",progresso:"Lendo arquivo..."}]);
      try{
        if(isDXF){
          // DXF: extrai dados geométricos exatos no servidor
          setPendentes(p=>p.map(x=>x.id===id?{...x,progresso:"Extraindo geometria do DXF..."}:x));
          const form=new FormData(); form.append("file",file,file.name);
          const resp=await fetch("/api/parse-dxf",{method:"POST",body:form});
          const dxfData=await resp.json();
          if(dxfData.error) throw new Error(dxfData.error);
          const nL=dxfData.resumo?.total_layers||0;
          const nB=dxfData.resumo?.total_blocos||0;
          setPendentes(p=>p.map(x=>x.id===id?{...x,dxfData,status:"pronto",progresso:`DXF ✓ · ${nL} layers · ${nB} blocos · ${disc||"disciplina a detectar"}`}:x));
        } else if(file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")){
          // PDF: renderiza em alta resolução e divide em tiles
          setPendentes(p=>p.map(x=>x.id===id?{...x,progresso:"Renderizando em alta resolução..."}:x));
          let imgs=[]; let progDesc="";
          try {
            imgs = await pdfParaImagensTiles(file,
              (msg) => setPendentes(p=>p.map(x=>x.id===id?{...x,progresso:msg}:x))
            );
            progDesc = `${imgs.length} tile${imgs.length>1?"s":""} alta res.`;
          } catch (renderErr) {
            console.warn("[PDF tiles] falhou, enviando PDF bruto como fallback:", renderErr);
            const tamanhoMB=(file.size/1024/1024).toFixed(1);
            if(file.size > 3_000_000){
              const {fileUri, mimeType} = await uploadParaGeminiFileAPI(file,
                (msg) => setPendentes(p=>p.map(x=>x.id===id?{...x,progresso:msg}:x))
              );
              imgs=[{fileUri, type:mimeType}];
              progDesc=`PDF bruto · ${tamanhoMB} MB`;
            } else {
              imgs=[{base64:await toB64(file),type:"application/pdf"}];
              progDesc=`PDF bruto · ${tamanhoMB} MB`;
            }
          }
          setPendentes(p=>p.map(x=>x.id===id?{...x,imgs,status:"pronto",progresso:`${progDesc} · ${disc||"disciplina a detectar"}`}:x));
        } else if(file.type.startsWith("image/")){
          const imgs=[{base64:await toB64(file),type:file.type}];
          setPendentes(p=>p.map(x=>x.id===id?{...x,imgs,status:"pronto",progresso:`1 imagem · ${disc||"disciplina a detectar"}`}:x));
        } else {
          setPendentes(p=>p.filter(x=>x.id!==id)); continue;
        }
      } catch(e){
        setPendentes(p=>p.map(x=>x.id===id?{...x,status:"erro",progresso:"Erro ao ler: "+e.message}:x));
      }
    }
  };

  // Orçar tudo — analisar todas as pendentes
  const orcaTudo = async()=>{
    const prontas=pendentes.filter(p=>p.status==="pronto");
    if(!prontas.length)return;
    setOrcando(true);setErro("");

    for(let pi=0;pi<prontas.length;pi++){
      const pend=prontas[pi];
      // Delay de 4s entre plantas (exceto a primeira) para respeitar rate limit do Gemini free
      if(pi>0) await new Promise(r=>setTimeout(r,4000));
      setPendentes(p=>p.map(x=>x.id===pend.id?{...x,status:"analisando",progresso:"IA analisando..."}:x));
      try{
        const obraAtualSnap = obras.find(o => o.id === obra.id);
        const plantasExist  = (obraAtualSnap?.plantas || []).filter(p => p.itens?.length > 0);
        const obraCtx       = montarObraCtx(obra, plantasExist);

        // ── Branch DXF: envia dados estruturados como texto, não como imagem ──
        if(pend.dxfData){
          setPendentes(p=>p.map(x=>x.id===pend.id?{...x,progresso:"IA quantificando DXF..."}:x));
          const dxfPrompt = getDxfPrompt(pend.disciplina, obraCtx, pend.dxfData);
          const dxfUserText = `Arquivo DXF: "${pend.fileName}" · Disciplina: ${pend.disciplina||"a identificar"}\n`
            + `Resumo: ${pend.dxfData.resumo.total_layers} layers · ${pend.dxfData.resumo.total_comprimento_m}m comprimento total · `
            + `${pend.dxfData.resumo.total_area_m2}m² área total · ${pend.dxfData.resumo.total_blocos} blocos.\n`
            + "Quantifique todos os elementos baseado nos dados geométricos exatos fornecidos no sistema.";
          const agora=Date.now();
          const espThrottle=3500-(agora-ultimaRequisicao.current);
          if(espThrottle>0) await new Promise(r=>setTimeout(r,espThrottle));
          ultimaRequisicao.current=Date.now();
          const reqBodyDxf=JSON.stringify({model:"claude-sonnet-4-6",max_tokens:32768,system:dxfPrompt,
            messages:[{role:"user",content:[{type:"text",text:dxfUserText}]}]});
          let dataDxf=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:reqBodyDxf}).then(r=>r.json());
          for(let rt=0;rt<8&&dataDxf.error?.type==="rate_limit";rt++){
            const espera=(dataDxf.error.retryAfter||30)*1000;
            setPendentes(p=>p.map(x=>x.id===pend.id?{...x,progresso:`⏳ Aguardando ${Math.round(espera/1000)}s...`}:x));
            await new Promise(r=>setTimeout(r,espera));
            dataDxf=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:reqBodyDxf}).then(r=>r.json());
          }
          if(dataDxf.error) throw new Error(`Gemini: ${dataDxf.error.message||dataDxf.error.type}`);
          const dxfText=dataDxf.content?.find(b=>b.type==="text")?.text||"{}";
          const dxfClean=dxfText.replace(/```json[\s\S]*?```|```[\s\S]*?```/g,m=>m.replace(/```json|```/g,"")).replace(/```json|```/g,"").trim();
          let parsedDxf={itens:[]};
          try{ parsedDxf=JSON.parse((dxfClean.match(/\{[\s\S]*\}/)||["{}"])[0]); }catch{}
          const itensDedup=deduplicarItens(parsedDxf.itens||[]);
          setPendentes(p=>p.map(x=>x.id===pend.id?{...x,progresso:"Buscando preços SINAPI..."}:x));
          const { precoMap, unMap } = await resolverPrecosBatch(itensDedup);
          const disciplinaFinal=parsedDxf.disciplina||pend.disciplina;
          const escopo_excluir=obra.escopo_excluir||[];
          const fatoresCategorias=obra.fatores_categorias||{};
          const itensEnriquecidos=itensDedup.map(it=>{
            const codigoFinal=it._sinapi_real?.codigo||it.sinapi_sugerido;
            const unSinapi=unMap[codigoFinal]||it._sinapi_real?.un||null;
            const precoBase=it._sinapi_real?.preco||precoMap[it.sinapi_sugerido]||null;
            const precoMercado=precoBase?aplicarFatorCategoria(it.descricao,precoBase,fatoresCategorias):null;
            return{...it,sinapi_sugerido:codigoFinal,sinapi_descricao:it._sinapi_real?.descricao||it.sinapi_descricao,
              preco_sinapi:precoBase,preco_mercado:precoMercado,un_sinapi:unSinapi,
              un_valida:unCompativel(it.un,unSinapi),
              confianca:it.confianca||"alta", // DXF = sempre alta confiança (dados exatos)
              fora_escopo:itemForaDoEscopo(it,escopo_excluir),fonte:it.fonte||"📐 Cota",
              _dxf:true};
          });
          const novaPlanta={id:uid(),fileName:pend.fileName,disciplina:disciplinaFinal,
            escala:parsedDxf.escala||pend.dxfData.resumo?.escala,resumo:parsedDxf.resumo,
            alertas:parsedDxf.alertas||[],itens:itensEnriquecidos,
            consistencia:checaConsistencia(itensEnriquecidos,disciplinaFinal),
            tipo_fonte:"DXF",
            analisadoEm:new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})};
          atualizar(o=>({...o,plantas:[...(o.plantas||[]),novaPlanta]}));
          const totalValor=itensEnriquecidos.reduce((s,i)=>s+(i.preco_mercado||i.preco_sinapi||0)*(i.qtd||0),0);
          setPendentes(p=>p.map(x=>x.id===pend.id?{...x,status:"concluido",
            progresso:itensEnriquecidos.length===0?`⚠️ 0 itens DXF — verifique layers`:
            `✅ ${itensEnriquecidos.length} itens [DXF] · ${fmtR(totalValor)}`}:x));
          continue; // pula o branch de imagem
        }

        const prompt        = getPrompt(pend.disciplina, obraCtx, pend.fileName || "");
        const todosItens=[];let ultimoParsed=null;
        const isPDFBruto=pend.imgs.length===1&&pend.imgs[0].type==="application/pdf";
        const nTiles=pend.imgs.length;
        for(let i=0;i<nTiles;i++){
          // Delay entre tiles/páginas para respeitar rate limit Gemini (20 RPM)
          if(i>0) await new Promise(r=>setTimeout(r,4000));
          const img=pend.imgs[i];
          const tileLabel=img._tileLabel||`imagem ${i+1}/${nTiles}`;
          const pgMsg=`IA lendo ${tileLabel}${pend.disciplina?` · ${pend.disciplina}`:""}...`;
          setPendentes(p=>p.map(x=>x.id===pend.id?{...x,progresso:pgMsg}:x));
          const imgSource=img.fileUri
            ?{type:"file",  media_type:img.type, fileUri:img.fileUri}
            :{type:"base64",media_type:img.type, data:img.base64};
          // Texto de instrução varia por tipo: PDF bruto, tile parcial, ou imagem completa
          let userText;
          if(isPDFBruto){
            userText=`Analise TODAS as páginas/pranchas deste PDF de engenharia${pend.disciplina?` de ${pend.disciplina}`:""}: ${pend.fileName}. Extraia todos os quantitativos e retorne um único JSON consolidado.`;
          } else if(nTiles>1){
            const discLabel = pend.disciplina ? ` (${pend.disciplina})` : "";
            userText=`Esta é a ${tileLabel} da prancha "${pend.fileName}"${discLabel}. Imagem renderizada em alta resolução (3×). Leia TODAS as cotas, anotações e contagens visíveis nesta seção e extraia os itens correspondentes. Cada seção pode ter elementos únicos — extraia tudo que for visível.`;
          } else {
            userText=`Analise esta prancha${pend.disciplina?` de ${pend.disciplina}`:""}: ${pend.fileName}. Imagem em alta resolução — leia todas as cotas e anotações.`;
          }
          const reqBody=JSON.stringify({model:"claude-sonnet-4-6",max_tokens:32768,system:prompt,
            messages:[{role:"user",content:[
              {type:"image",source:imgSource},
              {type:"text",text:userText}
            ]}]
          });
          // Throttle: garante intervalo mínimo de 3.5s entre requisições (≤17 RPM global)
          const agora=Date.now();
          const espThrottle=3500-(agora-ultimaRequisicao.current);
          if(espThrottle>0) await new Promise(r=>setTimeout(r,espThrottle));
          ultimaRequisicao.current=Date.now();
          const chamar=async()=>{
            ultimaRequisicao.current=Date.now();
            const resp=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:reqBody});
            if(resp.status===413) return {error:{type:"file_too_large",message:"PDF muito grande (>4,5 MB). Tente comprimir ou dividir o arquivo."}};
            try{ return await resp.json(); }
            catch{ return {error:{type:"parse_error",message:`Resposta inesperada do servidor (HTTP ${resp.status})`}}; }
          };
          let data=await chamar();
          // Rate limit — retenta até 8x esperando o tempo sugerido
          for(let rt=0;rt<8&&data.error?.type==="rate_limit";rt++){
            const espera=(data.error.retryAfter||30)*1000;
            setPendentes(p=>p.map(x=>x.id===pend.id?{...x,progresso:`⏳ Aguardando ${Math.round(espera/1000)}s (tentativa ${rt+1}/8)...`}:x));
            await new Promise(r=>setTimeout(r,espera));
            data=await chamar();
          }
          if(data.error){
            throw new Error(`Gemini API: ${data.error.message||data.error.type||JSON.stringify(data.error)}`);
          }
          if(!data.content){
            throw new Error(`Resposta inesperada da API: ${JSON.stringify(data).slice(0,200)}`);
          }
          const text=data.content?.find(b=>b.type==="text")?.text||"{}";
          const finishReason=data.finishReason||"";
          console.log(`[IA pág.${i+1}] finishReason=${finishReason} len=${text.length} início:`, text.slice(0,300));
          let parsed={itens:[]};
          try{
            // Remove markdown fences mantendo o conteúdo
            const clean=text.replace(/```json[\s\S]*?```|```[\s\S]*?```/g, m=>m.replace(/```json|```/g,"")).replace(/```json|```/g,"").trim();
            // Tenta extrair o maior bloco JSON válido
            const jsonMatch=clean.match(/\{[\s\S]*\}/);
            if(jsonMatch){
              try{
                parsed=JSON.parse(jsonMatch[0]);
              }catch{
                // JSON truncado (MAX_TOKENS) — tenta recuperar itens já completos
                const itensMatch=jsonMatch[0].match(/"itens"\s*:\s*\[([\s\S]*)/);
                if(itensMatch){
                  const itensStr=itensMatch[1];
                  // Encontra objetos completos de item
                  const itemRegex=/\{[^{}]*(?:"[^"]*"[^{}]*)*\}/g;
                  const partialItens=[];
                  let m;
                  while((m=itemRegex.exec(itensStr))!==null){
                    try{ partialItens.push(JSON.parse(m[0])); }catch{}
                  }
                  if(partialItens.length>0){
                    parsed={itens:partialItens,resumo:"(resposta truncada — itens parciais recuperados)"};
                    console.warn(`JSON truncado, recuperados ${partialItens.length} itens parciais`);
                  }
                }
              }
            }
          }catch(parseErr){
            console.warn("Falha ao parsear JSON da IA:", parseErr.message, "Texto:", text.slice(0,500));
          }
          parsed._finishReason=finishReason;
          todosItens.push(...(parsed.itens||[]));
          ultimoParsed=parsed;
        }
        // Deduplica itens antes de enriquecer (remove elementos contados múltiplas vezes)
        const itensDedup = deduplicarItens(todosItens);

        // Buscar preços SINAPI + UNs para validação
        setPendentes(p=>p.map(x=>x.id===pend.id?{...x,progresso:"Buscando preços SINAPI..."}:x));
        const { precoMap, unMap } = await resolverPrecosBatch(itensDedup);
        const disciplinaFinal = ultimoParsed?.disciplina || pend.disciplina;
        const escopo_excluir = obra.escopo_excluir || [];
        const fatoresCategorias = obra.fatores_categorias || {};
        const itensEnriquecidos=itensDedup.map(it=>{
          const codigoFinal  = it._sinapi_real?.codigo || it.sinapi_sugerido;
          const unSinapi     = unMap[codigoFinal] || it._sinapi_real?.un || null;
          const unValida     = unCompativel(it.un, unSinapi);
          const confianca    = it.confianca || (it.fonte === "📐 Cota" || it.fonte === "🔢 Contagem" ? "alta" : it.fonte === "🧮 Cálculo" ? "media" : "baixa");
          const precoBase    = it._sinapi_real?.preco || precoMap[it.sinapi_sugerido] || null;
          return {
            ...it,
            sinapi_sugerido:  codigoFinal,
            sinapi_descricao: it._sinapi_real?.descricao || it.sinapi_descricao,
            preco_sinapi:     precoBase,
            preco_mercado:    precoBase ? aplicarFatorCategoria(it.descricao, precoBase, fatoresCategorias) : null,
            mat_preco:        precoMap[it.mat_sinapi] || null,
            un_sinapi:        unSinapi,
            un_valida:        unValida,
            confianca,
            fora_escopo:      itemForaDoEscopo(it, escopo_excluir),
            _sinapi_top3:     it._sinapi_top3 || [],
          };
        });
        const nPrecos = itensEnriquecidos.filter(i=>i.preco_sinapi).length;
        const nUnOk   = itensEnriquecidos.filter(i=>i.un_valida===true).length;
        console.log(`SINAPI: ${nPrecos}/${itensEnriquecidos.length} preços · ${nUnOk} UNs validadas`);
        const consistencia = checaConsistencia(itensEnriquecidos, disciplinaFinal);
        const novaPlanta={
          id:uid(),fileName:pend.fileName,
          disciplina:disciplinaFinal,
          escala:ultimoParsed?.escala,resumo:ultimoParsed?.resumo,
          alertas:ultimoParsed?.alertas||[],itens:itensEnriquecidos,
          consistencia,
          analisadoEm:new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}),
        };
        atualizar(o=>({...o,plantas:[...(o.plantas||[]),novaPlanta]}));
        const totalValor=itensEnriquecidos.reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0);
        const ultimoFinish=ultimoParsed?._finishReason||"";
        const progMsg=itensEnriquecidos.length===0
          ?`⚠️ 0 itens${ultimoFinish?` [${ultimoFinish}]`:""} — IA: "${(ultimoParsed?.resumo||ultimoParsed?.disciplina||"sem conteúdo detectado").slice(0,100)}"`
          :`✅ ${itensEnriquecidos.length} itens · ${fmtR(totalValor)}`;
        setPendentes(p=>p.map(x=>x.id===pend.id?{...x,status:"concluido",progresso:progMsg}:x));
      } catch(e){
        setPendentes(p=>p.map(x=>x.id===pend.id?{...x,status:"erro",progresso:"Erro: "+e.message}:x));
      }
    }
    setOrcando(false);
    // Limpar as concluídas após 15s (tempo para ler debug de 0 itens)
    setTimeout(()=>setPendentes(p=>p.filter(x=>x.status!=="concluido"&&x.status!=="erro")),15000);
  };

  const removerPendente=(id)=>setPendentes(p=>p.filter(x=>x.id!==id));
  const plantas=obraAtual?.plantas||[];
  const prontas=pendentes.filter(p=>p.status==="pronto");
  const totalOrcado=plantas.reduce((s,p)=>(p.itens||[]).reduce((ss,i)=>ss+(i.preco_sinapi||0)*(i.qtd||0),s),0);

  return (
    <div>
      <button onClick={onBack} style={{...S.btn,fontSize:12,marginBottom:20}}>← Voltar</button>
      <div style={{marginBottom:20}}>
        {cliente&&<div style={{fontSize:12,color:"#6b7280",marginBottom:4}}>{cliente.nome}</div>}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
          <h1 style={{fontSize:22,fontWeight:700,margin:0}}>{obra.nome}</h1>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {totalOrcado>0&&<div style={{fontSize:14,fontWeight:700,color:"#059669"}}>{fmtR(totalOrcado)} <span style={{fontSize:12,fontWeight:400,color:"#6b7280"}}>sem BDI</span></div>}
            {plantas.length>0&&(
              <button onClick={verificarTodasPlantas} disabled={verificandoGeral} style={{...S.btn,fontSize:12,display:"flex",alignItems:"center",gap:6,opacity:verificandoGeral?0.7:1}}>
                {verificandoGeral?<><span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⚙️</span> Verificando...</>:"🔍 Verificar IA"}
              </button>
            )}
          </div>
        </div>
        {obra.descricao&&<p style={{fontSize:13,color:"#6b7280",margin:"4px 0 0"}}>{obra.descricao}</p>}
      </div>

      {/* Painel de verificação geral */}
      {verificacaoGeral&&(
        <div style={{...S.card,padding:16,marginBottom:16,border:"1px solid #bae6fd",background:"#f0f9ff"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:700,color:"#0369a1"}}>🔍 Verificação IA — {verificacaoGeral.flags?.length||0} flag{verificacaoGeral.flags?.length!==1?"s":""} encontrada{verificacaoGeral.flags?.length!==1?"s":""}</div>
            <div style={{display:"flex",gap:8}}>
              {(verificacaoGeral.flags||[]).length>0&&(
                <button onClick={corrigirComIA} disabled={corrigindo} style={{...S.btnPrimary,fontSize:12,padding:"5px 12px",opacity:corrigindo?0.7:1}}>
                  {corrigindo?"⏳ Gerando correções...":"🔧 Corrigir com IA"}
                </button>
              )}
              <button onClick={()=>{setVerificacaoGeral(null);setCorrecoes(null);}} style={{fontSize:12,color:"#9ca3af",background:"none",border:"none",cursor:"pointer"}}>✕</button>
            </div>
          </div>
          {verificacaoGeral.resumo_geral&&<div style={{fontSize:12,color:"#0c4a6e",marginBottom:10,padding:"8px 12px",background:"#e0f2fe",borderRadius:8}}>{verificacaoGeral.resumo_geral}</div>}
          {(verificacaoGeral.flags||[]).length>0&&(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {(verificacaoGeral.flags||[]).map((f,k)=>(
                <div key={k} style={{display:"flex",gap:10,padding:"8px 10px",borderRadius:8,background:"#fff",border:"1px solid #e0f2fe",alignItems:"flex-start"}}>
                  <span style={{fontSize:11,padding:"2px 8px",borderRadius:20,flexShrink:0,marginTop:1,background:f.gravidade==="alta"?"#fee2e2":f.gravidade==="media"?"#fef3c7":"#f3f4f6",color:f.gravidade==="alta"?"#991b1b":f.gravidade==="media"?"#92400e":"#374151"}}>{f.gravidade}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,color:"#6b7280",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.planta} {f.codigo_item&&<span style={{fontFamily:"monospace",color:"#0369a1"}}>· {f.codigo_item}</span>}</div>
                    <div style={{fontSize:12,color:"#374151"}}>{f.problema}</div>
                    {f.sugestao&&<div style={{fontSize:11,color:"#0369a1",marginTop:2}}>→ {f.sugestao}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview de correções propostas pela IA */}
      {correcoes&&(
        <div style={{...S.card,padding:16,marginBottom:16,border:"1px solid #bbf7d0",background:"#f0fdf4"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:700,color:"#166534"}}>🔧 Correções propostas — {correcoes.correcoes?.length||0} item{correcoes.correcoes?.length!==1?"s":""}</div>
            <button onClick={()=>setCorrecoes(null)} style={{fontSize:12,color:"#9ca3af",background:"none",border:"none",cursor:"pointer"}}>✕</button>
          </div>
          {correcoes.erro&&<div style={{fontSize:12,color:"#dc2626",marginBottom:8}}>{correcoes.erro}</div>}
          {(correcoes.correcoes||[]).map((c,k)=>(
            <div key={k} style={{padding:"8px 10px",borderRadius:8,background:"#fff",border:"1px solid #bbf7d0",marginBottom:6}}>
              <div style={{fontSize:11,color:"#6b7280",marginBottom:3}}>{c.planta} <span style={{fontFamily:"monospace",color:"#059669"}}>· {c.codigo_item}</span> — campo: <strong>{c.campo}</strong></div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:12,color:"#dc2626",textDecoration:"line-through"}}>{String(c.valor_atual)}</span>
                <span style={{fontSize:12,color:"#6b7280"}}>→</span>
                <span style={{fontSize:12,fontWeight:700,color:"#059669"}}>{String(c.valor_novo)}</span>
              </div>
              <div style={{fontSize:11,color:"#6b7280",marginTop:3,fontStyle:"italic"}}>{c.justificativa}</div>
            </div>
          ))}
          {(correcoes.licoes||[]).length>0&&(
            <div style={{marginTop:10,padding:"8px 10px",background:"#dcfce7",borderRadius:8}}>
              <div style={{fontSize:11,fontWeight:700,color:"#166534",marginBottom:4}}>📚 {correcoes.licoes.length} lição{correcoes.licoes.length!==1?"":"s"} aprendida{correcoes.licoes.length!==1?"s":""} — será salva e aplicada nas próximas análises</div>
              {correcoes.licoes.map((l,k)=><div key={k} style={{fontSize:11,color:"#166534",marginBottom:2}}>⚠ {l.padrao} → {l.correcao}</div>)}
            </div>
          )}
          {(correcoes.correcoes||[]).length>0&&(
            <button onClick={aplicarCorrecoes} style={{...S.btnPrimary,marginTop:12,background:"#059669",fontSize:13,padding:"8px 18px"}}>
              ✓ Aplicar {correcoes.correcoes.length} correçõ{correcoes.correcoes.length===1?"":"es"} e salvar lições
            </button>
          )}
        </div>
      )}

      {/* Confirmação de aplicação */}
      {nAplicadas>0&&(
        <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:12,color:"#166534",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          ✓ {nAplicadas} item{nAplicadas!==1?"s":""} corrigido{nAplicadas!==1?"s":""} pela IA. Lições salvas para as próximas análises.
          <button onClick={()=>setNAplicadas(0)} style={{fontSize:12,color:"#6b7280",background:"none",border:"none",cursor:"pointer"}}>✕</button>
        </div>
      )}

      {/* Dica de nomenclatura */}
      <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:12,color:"#166534"}}>
        💡 Aceita <strong>PDF</strong> e <strong>DXF do AutoCAD</strong>. Nomeie com o prefixo da disciplina:
        <strong> ARQ- ELE- HID- PLU- INC- HVA- CFT- VOZ- SPD- GAS- EST-</strong>
        <br/><span style={{color:"#0369a1"}}>DXF = precisão milimétrica (lê coordenadas exatas do CAD, não estimativas de imagem)</span>
      </div>

      {/* Zona de drop */}
      <div onDrop={e=>{e.preventDefault();setDragOver(false);carregarArquivos(e.dataTransfer.files);}}
        onDragOver={e=>{e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        style={{border:`2px dashed ${dragOver?"#2563eb":"#d1d5db"}`,borderRadius:12,padding:"20px",textAlign:"center",background:dragOver?"#eff6ff":"#fafafa",marginBottom:16,transition:"all .15s"}}>
        <div style={{fontSize:28,marginBottom:6}}>📁</div>
        <div style={{fontSize:14,fontWeight:600,marginBottom:3}}>Arraste as plantas aqui</div>
        <div style={{fontSize:12,color:"#9ca3af",marginBottom:14}}>PDF ou <strong>DXF do AutoCAD</strong> (ARQ, ELE, HID, PLU, INC...) — DXF fornece medição exata de camadas e blocos</div>
        <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
          <button onClick={e=>{e.stopPropagation();fileRef.current?.click();}} style={{...S.btn,fontSize:12,padding:"7px 16px"}}>📄 Selecionar arquivos</button>
          <button onClick={e=>{e.stopPropagation();folderRef.current?.click();}} style={{...S.btn,fontSize:12,padding:"7px 16px"}}>📂 Selecionar pasta</button>
        </div>
        <input ref={fileRef} type="file" multiple accept=".pdf,.dxf,image/*" style={{display:"none"}} onChange={e=>carregarArquivos(e.target.files)}/>
        <input ref={folderRef} type="file" multiple accept=".pdf,.dxf,image/*" style={{display:"none"}}
          {...{webkitdirectory:"",directory:""}}
          onChange={e=>{
            const pdfs = Array.from(e.target.files).filter(f=>f.type==="application/pdf"||f.type.startsWith("image/"));
            carregarArquivos(pdfs);
            e.target.value="";
          }}/>
      </div>

      {/* Lista de pendentes */}
      {pendentes.length>0&&(
        <div style={{...S.card,overflow:"hidden",marginBottom:16}}>
          <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <span style={{fontSize:13,fontWeight:600}}>{pendentes.length} planta{pendentes.length!==1?"s":""} carregada{pendentes.length!==1?"s":""}</span>
              {prontas.length>0&&<span style={{fontSize:12,color:"#6b7280",marginLeft:8}}>· {prontas.length} pronta{prontas.length!==1?"s":""} para orçar</span>}
            </div>
            {prontas.length>0&&(
              <button onClick={orcaTudo} disabled={orcando} style={{...S.btnPrimary,padding:"8px 20px",fontSize:13,display:"flex",alignItems:"center",gap:8,opacity:orcando?0.7:1}}>
                {orcando
                  ? <><span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⚙️</span> Orçando...</>
                  : <>💰 Orçar {prontas.length} planta{prontas.length!==1?"s":""}</>
                }
              </button>
            )}
          </div>
          {pendentes.map(p=>{
            const col=DISC_COR[p.disciplina]||{};
            const statusCor = p.status==="concluido"?"#059669":p.status==="erro"?"#dc2626":p.status==="analisando"?"#2563eb":"#374151";
            const statusBg  = p.status==="concluido"?"#f0fdf4":p.status==="erro"?"#fef2f2":p.status==="analisando"?"#eff6ff":"#fafafa";
            return (
              <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",borderBottom:"1px solid #f3f4f6",background:statusBg,transition:"background .3s"}}>
                <div style={{fontSize:20,flexShrink:0}}>
                  {p.status==="carregando"?"⏳":p.status==="analisando"?<span style={{display:"inline-block",animation:"spin 1s linear infinite"}}>⚙️</span>:p.status==="concluido"?"✅":p.status==="erro"?"❌":"📄"}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.fileName}</div>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginTop:2}}>
                    {p.disciplina&&<span style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:col.bg||"#f3f4f6",color:col.text||"#374151",border:`1px solid ${col.border||"#e5e7eb"}`}}>{p.disciplina}</span>}
                    <span style={{fontSize:11,color:statusCor}}>{p.progresso}</span>
                  </div>
                </div>
                {p.status==="pronto"&&<button onClick={()=>removerPendente(p.id)} style={{fontSize:12,color:"#9ca3af",background:"none",border:"none",cursor:"pointer",flexShrink:0}}>✕</button>}
              </div>
            );
          })}
        </div>
      )}

      {erro&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#dc2626"}}>{erro}</div>}

      {/* Plantas já orçadas */}
      {plantas.length>0&&(
        <div>
          <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:10}}>Plantas analisadas ({plantas.length})</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {plantas.map(p=>{
              const nItens=p.itens?.length||0;
              const nPreco=p.itens?.filter(i=>i.preco_sinapi)?.length||0;
              const total=p.itens?.reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0)||0;
              const col=DISC_COR[p.disciplina]||{};
              return (
                <div key={p.id} onClick={()=>onOpenPlanta(p.id)} style={{...S.card,padding:14,display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}
                  onMouseOver={e=>e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,.06)"}
                  onMouseOut={e=>e.currentTarget.style.boxShadow=""}>
                  <div style={{fontSize:24,flexShrink:0}}>📐</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.fileName}</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                      {p.disciplina&&<span style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:col.bg||"#f3f4f6",color:col.text||"#374151",border:`1px solid ${col.border||"#e5e7eb"}`}}>{p.disciplina}</span>}
                      {p.escala&&<span style={{fontSize:11,color:"#9ca3af"}}>escala {p.escala}</span>}
                      <span style={{fontSize:11,color:nItens===0?"#dc2626":"#9ca3af"}}>{nItens} itens{nItens>0?` · ${nPreco} cotados`:""}</span>
                      {total>0&&<span style={{fontSize:11,color:"#059669",fontWeight:600}}>{fmtR(total)}</span>}
                      {p.tipo_fonte==="DXF"&&<span style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:"#dbeafe",color:"#1e40af",border:"1px solid #93c5fd",fontWeight:600}}>DXF</span>}
                      {p.consistencia?.tipo==="aviso"&&<span style={{fontSize:11,color:"#b45309",background:"#fef3c7",padding:"1px 7px",borderRadius:20,border:"1px solid #fcd34d"}} title={p.consistencia.msg}>⚠ aço/concreto</span>}
                      {p.consistencia?.tipo==="ok"&&<span style={{fontSize:11,color:"#065f46",background:"#d1fae5",padding:"1px 7px",borderRadius:20,border:"1px solid #6ee7b7"}} title={p.consistencia.msg}>✓ estrutura ok</span>}
                      {(p.itens||[]).filter(i=>i.corrigido_ia).length>0&&<span style={{fontSize:11,color:"#059669",background:"#f0fdf4",padding:"1px 7px",borderRadius:20,border:"1px solid #bbf7d0"}}>🔧 {(p.itens||[]).filter(i=>i.corrigido_ia).length} corrigido{(p.itens||[]).filter(i=>i.corrigido_ia).length!==1?"s":""}</span>}
                    </div>
                    {nItens===0&&p.resumo&&<div style={{fontSize:11,color:"#6b7280",marginTop:4,fontStyle:"italic"}}>IA: "{p.resumo.slice(0,120)}"</div>}
                  </div>
                  <div style={{display:"flex",gap:8,flexShrink:0}}>
                    <button onClick={e=>{e.stopPropagation();if(confirm("Excluir?"))atualizar(o=>({...o,plantas:o.plantas.filter(x=>x.id!==p.id)}));}} style={{fontSize:12,color:"#dc2626",background:"none",border:"none",cursor:"pointer"}}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {plantas.length===0&&pendentes.length===0&&(
        <div style={{textAlign:"center",padding:"40px 0",color:"#9ca3af",fontSize:13}}>Nenhuma planta ainda. Arraste os PDFs acima.</div>
      )}
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const CONF_STYLE = {
  alta:  {bg:"#d1fae5",color:"#065f46",label:"alta"},
  media: {bg:"#fef3c7",color:"#92400e",label:"média"},
  baixa: {bg:"#fee2e2",color:"#991b1b",label:"baixa"},
};

// ─── VISUALIZADOR ─────────────────────────────────────────────────────────────
function VisualizadorPlanta({planta,obra,onBack,obras,setObras}) {
  const [filtro,setFiltro]         = useState("Todos");
  const [filtroConf,setFiltroConf] = useState("Todos");
  const [bdi,setBdi]               = useState(25);
  const [verificando,setVerificando] = useState(false);
  const [verificacao,setVerificacao] = useState(null);

  const itens       = planta.itens||[];
  const itensEscopo = itens.filter(i=>!i.fora_escopo);
  const itensExcl   = itens.filter(i=>i.fora_escopo);
  let filtrados     = filtro==="Todos"?itensEscopo:itensEscopo.filter(i=>i.fonte===filtro);
  filtrados         = filtroConf==="Todos"?filtrados:filtrados.filter(i=>(i.confianca||"media")===filtroConf);
  const temMercado   = itensEscopo.some(i=>i.preco_mercado && i.preco_mercado !== i.preco_sinapi);
  const comPreco    = itensEscopo.filter(i=>i.preco_sinapi);
  const totalSemBdi = comPreco.reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0);
  const totalComBdi = totalSemBdi*(1+bdi/100);
  const totalMercado= comPreco.reduce((s,i)=>s+(i.preco_mercado||i.preco_sinapi||0)*(i.qtd||0),0);
  const totalMercBdi= totalMercado*(1+bdi/100);
  const cobertura   = itensEscopo.length?Math.round((comPreco.length/itensEscopo.length)*100):0;
  const col         = DISC_COR[planta.disciplina]||{};
  const nUnInvalidas = itensEscopo.filter(i=>i.un_valida===false).length;
  const nBaixa      = itensEscopo.filter(i=>i.confianca==="baixa").length;

  const verificarQuantitativos = async () => {
    if (verificando || itens.length === 0) return;
    setVerificando(true);setVerificacao(null);
    try {
      const resumoItens = itens.map(i => `${i.codigo_item}: ${i.descricao} (${i.qtd} ${i.un}) — conf:${i.confianca||"?"} obs:${i.obs||""}`).join("\n");
      const promptVerif = `Você é um orçamentista sênior revisando quantitativos extraídos de uma planta de ${planta.disciplina||"engenharia"}.\n\nItens extraídos:\n${resumoItens}\n\nRevise cada item e identifique:\n1. Quantidades que parecem fora da escala típica para este tipo de obra\n2. Inconsistências entre unidade e descrição\n3. Itens que provavelmente foram duplicados ou estão faltando\n\nRetorne APENAS JSON: {"flags":[{"codigo_item":"XXX-001","problema":"descrição do problema","sugestao":"valor ou ação sugerida","gravidade":"alta|media|baixa"}],"ok":"comentário geral sobre os quantitativos"}`;
      const reqBody = JSON.stringify({model:"claude-sonnet-4-6",max_tokens:4096,system:promptVerif,messages:[{role:"user",content:[{type:"text",text:"Revise os quantitativos listados."}]}]});
      const resp = await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:reqBody});
      const data = await resp.json();
      const text = data.content?.find(b=>b.type==="text")?.text||"{}";
      const clean = text.replace(/```json|```/g,"").trim();
      const json  = JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0]||"{}");
      setVerificacao(json);
    } catch(e) {
      setVerificacao({flags:[],ok:`Erro na verificação: ${e.message}`});
    }
    setVerificando(false);
  };


    const exportar=()=>{
    const rows=["\uFEFFCódigo,Descrição,Un.,Qtd.,Fonte,SINAPI,Preço Unit.,Subtotal,c/BDI,Obs."];
    filtrados.forEach(it=>{const sub=(it.preco_sinapi||0)*(it.qtd||0);rows.push(`"${it.codigo_item}","${it.descricao}","${it.un}","${it.qtd}","${it.fonte}","${it.sinapi_sugerido||""}","${it.preco_sinapi||""}","${sub.toFixed(2)}","${(sub*(1+bdi/100)).toFixed(2)}","${it.obs||""}"`);});
    rows.push(`"","","","","","","TOTAL SEM BDI","${totalSemBdi.toFixed(2)}","",""`);
    rows.push(`"","","","","","","TOTAL COM BDI ${bdi}%","","${totalComBdi.toFixed(2)}",""`);
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv;charset=utf-8;"}));a.download=`ORC_${planta.fileName?.replace(/[^a-zA-Z0-9]/g,"_").slice(0,25)}.csv`;a.click();
  };

  return (
    <div>
      <button onClick={onBack} style={{...S.btn,fontSize:12,marginBottom:20}}>← {obra.nome}</button>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,flexWrap:"wrap"}}>
            <h1 style={{fontSize:17,fontWeight:700,margin:0}}>{planta.fileName}</h1>
            {planta.disciplina&&<span style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:col.bg||"#f3f4f6",color:col.text||"#374151",border:`1px solid ${col.border||"#e5e7eb"}`}}>{planta.disciplina}</span>}
            {planta.escala&&<span style={{fontSize:11,color:"#9ca3af",background:"#f9fafb",padding:"2px 8px",borderRadius:20}}>escala {planta.escala}</span>}
          </div>
          {planta.resumo&&<p style={{fontSize:12,color:"#6b7280",margin:0,maxWidth:700}}>{planta.resumo}</p>}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={verificarQuantitativos} disabled={verificando} style={{...S.btn,fontSize:12,opacity:verificando?0.7:1}}>
            {verificando?"⏳ Verificando...":"🔍 Verificar IA"}
          </button>
          <button onClick={exportar} style={S.btn}>↓ CSV</button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:12}}>
        {[
          {label:"Itens",valor:itens.length,cor:"#111"},
          {label:"SINAPI cobertos",valor:`${cobertura}%`,cor:cobertura>=70?"#059669":"#f59e0b"},
          {label:"Conf. baixa",valor:nBaixa,cor:nBaixa>0?"#b45309":"#059669",hint:"Itens estimados por escala/inferência"},
          {label:"UN inválida",valor:nUnInvalidas,cor:nUnInvalidas>0?"#dc2626":"#059669",hint:"Unidade do item ≠ unidade SINAPI"},
          {label:"Fora do escopo",valor:itensExcl.length,cor:itensExcl.length>0?"#6b7280":"#059669",hint:"Executados por terceiros — excluídos do total"},
          {label:"Total SINAPI",valor:fmtR(totalSemBdi),cor:"#059669"},
          {label:`SINAPI c/ BDI ${bdi}%`,valor:fmtR(totalComBdi),cor:"#059669"},
          ...(temMercado?[
            {label:"Total mercado",valor:fmtR(totalMercado),cor:"#7c3aed",hint:"Preços de mercado (fatores por categoria)"},
            {label:`Mercado c/ BDI ${bdi}%`,valor:fmtR(totalMercBdi),cor:"#7c3aed"},
          ]:[]),
        ].map(c=>(
          <div key={c.label} title={c.hint||""} style={{background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:10,padding:"11px 14px",cursor:c.hint?"help":"default"}}>
            <div style={{fontSize:11,color:"#6b7280",marginBottom:3}}>{c.label}</div>
            <div style={{fontSize:17,fontWeight:700,color:c.cor}}>{c.valor}</div>
          </div>
        ))}
      </div>

      {/* Painel de consistência estrutural */}
      {planta.consistencia&&(
        <div style={{background:planta.consistencia.tipo==="ok"?"#f0fdf4":"#fffbeb",border:`1px solid ${planta.consistencia.tipo==="ok"?"#bbf7d0":"#fde68a"}`,borderRadius:10,padding:"10px 16px",marginBottom:12,fontSize:12,color:planta.consistencia.tipo==="ok"?"#166534":"#92400e"}}>
          {planta.consistencia.tipo==="ok"?"✓":"⚠"} {planta.consistencia.msg}
        </div>
      )}

      {/* Painel de verificação IA */}
      {verificacao&&(
        <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:"12px 16px",marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,color:"#0369a1",marginBottom:8}}>🔍 Verificação IA — {verificacao.flags?.length||0} flag{verificacao.flags?.length!==1?"s":""}</div>
          {verificacao.ok&&<div style={{fontSize:12,color:"#0c4a6e",marginBottom:8,fontStyle:"italic"}}>{verificacao.ok}</div>}
          {(verificacao.flags||[]).map((f,k)=>(
            <div key={k} style={{display:"flex",gap:10,padding:"6px 0",borderBottom:"1px solid #e0f2fe",alignItems:"flex-start"}}>
              <span style={{fontSize:11,padding:"1px 7px",borderRadius:20,background:f.gravidade==="alta"?"#fee2e2":f.gravidade==="media"?"#fef3c7":"#f3f4f6",color:f.gravidade==="alta"?"#991b1b":f.gravidade==="media"?"#92400e":"#374151",flexShrink:0,marginTop:1}}>{f.gravidade}</span>
              <div style={{flex:1}}>
                <span style={{fontSize:12,fontWeight:600,fontFamily:"monospace",color:"#0369a1"}}>{f.codigo_item}</span>
                <span style={{fontSize:12,color:"#374151",marginLeft:8}}>{f.problema}</span>
                {f.sugestao&&<div style={{fontSize:11,color:"#0369a1",marginTop:2}}>→ {f.sugestao}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"#6b7280"}}>BDI:</span>
        <input type="range" min={0} max={50} value={bdi} onChange={e=>setBdi(Number(e.target.value))} style={{width:100}}/>
        <input type="number" value={bdi} onChange={e=>setBdi(Number(e.target.value))} min={0} max={100} style={{width:52,padding:"4px 8px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,textAlign:"center"}}/>%
        <div style={{width:1,height:18,background:"#e5e7eb",margin:"0 4px"}}/>
        {Object.entries(FONTE_COR).map(([k,v])=>(
          <span key={k} onClick={()=>setFiltro(filtro===k?"Todos":k)} style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:v.bg,color:v.color,cursor:"pointer",border:filtro===k?`2px solid ${v.color}`:"1px solid transparent",fontWeight:filtro===k?600:400}}>{k}</span>
        ))}
        {filtro!=="Todos"&&<button onClick={()=>setFiltro("Todos")} style={{...S.btn,fontSize:11,padding:"2px 9px"}}>✕</button>}
        <div style={{width:1,height:18,background:"#e5e7eb"}}/>
        {["alta","media","baixa"].map(c=>{const cs=CONF_STYLE[c];return(
          <span key={c} onClick={()=>setFiltroConf(filtroConf===c?"Todos":c)} style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:cs.bg,color:cs.color,cursor:"pointer",border:filtroConf===c?`2px solid ${cs.color}`:"1px solid transparent",fontWeight:filtroConf===c?600:400}}>conf. {cs.label}</span>
        );})}
        {filtroConf!=="Todos"&&<button onClick={()=>setFiltroConf("Todos")} style={{...S.btn,fontSize:11,padding:"2px 9px"}}>✕</button>}
        <span style={{fontSize:11,color:"#9ca3af",marginLeft:"auto"}}>{filtrados.length} itens</span>
      </div>

      <div style={{...S.card,overflow:"hidden",marginBottom:14}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr>{["Cód.","Descrição","Un.","Qtd.","Conf.","Fonte","SINAPI","Desc. SINAPI","Preço Unit.","Subtotal",`c/BDI ${bdi}%`,"Obs."].map((h,i)=>(
              <th key={h} style={{...S.th,textAlign:[3,8,9,10].includes(i)?"right":"left"}}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {filtrados.map((it,j)=>{
                const sub=it.preco_sinapi?it.preco_sinapi*(it.qtd||0):null;
                const fb=FONTE_COR[it.fonte]||{bg:"#f3f4f6",color:"#6b7280"};
                const conf=it.confianca||"media";
                const cs=CONF_STYLE[conf]||CONF_STYLE.media;
                const unOk=it.un_valida;
                return (
                  <tr key={j} style={{background:j%2===0?"#fff":"#fafafa",borderBottom:"1px solid #f3f4f6"}}>
                    <td style={{...S.td,fontFamily:"monospace",fontSize:10,color:"#9ca3af",whiteSpace:"nowrap"}}>{it.codigo_item}</td>
                    <td style={{...S.td,lineHeight:1.4,minWidth:200}}>{it.descricao}</td>
                    <td style={{...S.td,textAlign:"center"}}>
                      <span style={{color:unOk===false?"#dc2626":"#374151"}} title={unOk===false?`UN item "${it.un}" ≠ SINAPI "${it.un_sinapi}"`:unOk===true?`Unidade validada com SINAPI ${it.un_sinapi}`:""}>{it.un}</span>
                      {unOk===false&&<span style={{fontSize:9,marginLeft:2,color:"#dc2626"}}>⚠</span>}
                    </td>
                    <td style={{...S.td,textAlign:"right",fontWeight:600}}>{fmt(it.qtd)}</td>
                    <td style={{...S.td,whiteSpace:"nowrap"}}><span style={{fontSize:10,padding:"2px 7px",borderRadius:20,background:cs.bg,color:cs.color}}>{cs.label}</span></td>
                    <td style={{...S.td,whiteSpace:"nowrap"}}><span style={{fontSize:10,padding:"2px 7px",borderRadius:20,background:fb.bg,color:fb.color}}>{it.fonte}</span></td>
                    <td style={{...S.td,fontFamily:"monospace",fontSize:11,color:it.sinapi_sugerido?"#2563eb":"#d1d5db",whiteSpace:"nowrap"}}>{it.sinapi_sugerido||"—"}</td>
                    <td style={{...S.td,fontSize:11,color:"#475569",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.sinapi_descricao||"—"}</td>
                    <td style={{...S.td,textAlign:"right",color:it.preco_sinapi?"#059669":"#d1d5db",whiteSpace:"nowrap"}}>{it.preco_sinapi?fmtR(it.preco_sinapi):"—"}</td>
                    <td style={{...S.td,textAlign:"right",fontWeight:600,color:sub?"#059669":"#d1d5db",whiteSpace:"nowrap"}}>{sub!==null?fmtR(sub):"—"}</td>
                    <td style={{...S.td,textAlign:"right",fontWeight:600,color:sub?"#047857":"#d1d5db",whiteSpace:"nowrap"}}>{sub!==null?fmtR(sub*(1+bdi/100)):"—"}</td>
                    <td style={{...S.td,fontSize:11,color:"#9ca3af",minWidth:160}}>{it.obs}</td>
                  </tr>
                );
              })}
            </tbody>
            {totalSemBdi>0&&(
              <tfoot>
                <tr style={{background:"#f9fafb",borderTop:"2px solid #e5e7eb"}}>
                  <td colSpan={8} style={{...S.td,textAlign:"right",fontWeight:600,fontSize:13}}>Total sem BDI</td>
                  <td style={{...S.td,textAlign:"right",fontWeight:700,color:"#059669",fontSize:13}}>{fmtR(totalSemBdi)}</td>
                  <td colSpan={2}/>
                </tr>
                <tr style={{background:"#f0fdf4"}}>
                  <td colSpan={8} style={{...S.td,textAlign:"right",fontWeight:600,fontSize:13}}>Total com BDI {bdi}%</td>
                  <td style={{...S.td,textAlign:"right",fontWeight:800,color:"#059669",fontSize:15}}>{fmtR(totalComBdi)}</td>
                  <td colSpan={2}/>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {itensExcl.length>0&&(
        <div style={{background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:10,padding:"12px 16px",marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:"#6b7280",marginBottom:8}}>🚫 Fora do escopo — {itensExcl.length} item{itensExcl.length!==1?"s":""} excluído{itensExcl.length!==1?"s":""} do orçamento (executados por terceiros)</div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {itensExcl.map((it,j)=>(
              <div key={j} style={{fontSize:11,color:"#9ca3af",display:"flex",gap:12,padding:"4px 0",borderBottom:"1px solid #f3f4f6"}}>
                <span style={{fontFamily:"monospace",flexShrink:0}}>{it.codigo_item}</span>
                <span style={{flex:1,textDecoration:"line-through"}}>{it.descricao}</span>
                <span>{it.qtd} {it.un}</span>
                <span>{it.preco_sinapi?fmtR(it.preco_sinapi*(it.qtd||0)):"—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {planta.alertas?.length>0&&(
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"12px 16px"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#92400e",marginBottom:6}}>⚠ Confirmar em campo</div>
          <ul style={{margin:0,paddingLeft:18}}>{planta.alertas.map((a,k)=><li key={k} style={{fontSize:12,color:"#92400e",marginBottom:2}}>{a}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ─── SINAPI ───────────────────────────────────────────────────────────────────
function SecaoSinapi() {
  const [busca,setBusca]       = useState("");
  const [resultado,setResultado] = useState([]);
  const [info,setInfo]         = useState(null);
  const [loading,setLoading]   = useState(false);

  const pesquisar=async(q)=>{
    setBusca(q);if(q.length<2){setResultado([]);return;}
    setLoading(true);
    try{const r=await fetch(`/api/sinapi?q=${encodeURIComponent(q)}`);const d=await r.json();setResultado(d.itens||[]);if(d.referencia)setInfo(d);}catch{}
    setLoading(false);
  };

  return (
    <div>
      <h1 style={{fontSize:22,fontWeight:700,marginBottom:4}}>SINAPI Bahia</h1>
      <p style={{fontSize:13,color:"#6b7280",marginBottom:24}}>
        Consulte preços de referência.
        {info&&<span style={{color:"#059669",marginLeft:8}}>● Ref. {info.referencia} · {info.totalItens?.toLocaleString("pt-BR")} composições</span>}
      </p>
      <div style={{position:"relative",marginBottom:16}}>
        <input style={{...S.input,paddingLeft:36,fontSize:14}} value={busca} onChange={e=>pesquisar(e.target.value)} placeholder="Ex: porcelanato 60x60, tubo PVC 100mm, sprinkler, split 18000..."/>
        <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#9ca3af"}}>🔍</span>
        {loading&&<span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:"#9ca3af",fontSize:12}}>...</span>}
      </div>
      {resultado.length>0?(
        <div style={{...S.card,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr>{["Código","Descrição","Un.","Preço Ref. (R$)"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{resultado.map((item,j)=>(
              <tr key={j} style={{background:j%2===0?"#fff":"#fafafa"}}>
                <td style={{...S.td,fontFamily:"monospace",fontSize:11,color:"#2563eb",whiteSpace:"nowrap"}}>{item.codigo}</td>
                <td style={{...S.td,lineHeight:1.4}}>{item.descricao}</td>
                <td style={{...S.td,textAlign:"center",color:"#6b7280"}}>{item.un}</td>
                <td style={{...S.td,textAlign:"right",fontWeight:700,color:"#059669"}}>{fmtR(item.preco)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ):busca.length>=2&&!loading?(
        <div style={{textAlign:"center",padding:"40px 0",color:"#9ca3af",fontSize:13}}>Nenhum resultado para "{busca}".</div>
      ):(
        <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:"20px 24px"}}>
          <div style={{fontSize:12,fontWeight:600,color:"#475569",marginBottom:10}}>Sugestões:</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {["porcelanato","alvenaria bloco","drywall","tubo PVC","sprinkler","detector fumaça","split","bacia","cabo elétrico","concreto FCK25","terraplenagem","telha","luminária LED"].map(s=>(
              <button key={s} onClick={()=>pesquisar(s)} style={{...S.btn,fontSize:12,padding:"5px 12px"}}>{s}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ORÇAMENTO ────────────────────────────────────────────────────────────────
function SecaoOrcamento({obras}) {
  const [obraId,setObraId]       = useState("");
  const [plantaId,setPlantaId]   = useState("");
  const [bdi,setBdi]             = useState(25);
  const [exportando,setExportando] = useState(false);

  const exportarExcel = async (obraAlvo) => {
    if (!obraAlvo || exportando) return;
    setExportando(true);
    try {
      const resp = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ obra: obraAlvo, bdi }),
      });
      if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `ORC_${(obraAlvo.nome||"Obra").replace(/[^a-zA-Z0-9]/g,"_").slice(0,30)}_BDI${bdi}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) {
      alert("Erro ao exportar: " + e.message);
    } finally {
      setExportando(false);
    }
  };

  const obra   = obras.find(o=>o.id===obraId);
  const planta = obra?.plantas?.find(p=>p.id===plantaId);
  const itens  = planta?.itens||[];
  const comPreco    = itens.filter(i=>i.preco_sinapi);
  const totalSemBdi = comPreco.reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0);
  const totalComBdi = totalSemBdi*(1+bdi/100);

  const fatorMercado = (obra?.fator_mercado || 100) / 100;

  // Resumo por disciplina quando nenhuma planta selecionada
  const resumoObra=(obra?.plantas||[]).reduce((acc,p)=>{
    const d=p.disciplina||"Outros";
    if(!acc[d])acc[d]={total:0,itens:0};
    acc[d].itens+=p.itens?.length||0;
    acc[d].total+=(p.itens||[]).reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0);
    return acc;
  },{});

  const totalObra=Object.values(resumoObra).reduce((s,v)=>s+v.total,0);

  const exportar=()=>{
    const rows=["\uFEFFObra,Disciplina,Planta,Código,Descrição,Un.,Qtd.,SINAPI,Preço Unit.,Subtotal,c/BDI"];
    itens.forEach(it=>{const sub=(it.preco_sinapi||0)*(it.qtd||0);rows.push(`"${obra?.nome}","${planta?.disciplina}","${planta?.fileName}","${it.codigo_item}","${it.descricao}","${it.un}","${it.qtd}","${it.sinapi_sugerido||""}","${it.preco_sinapi||""}","${sub.toFixed(2)}","${(sub*(1+bdi/100)).toFixed(2)}"`);});
    rows.push(`"","","","","","","","","TOTAL SEM BDI","${totalSemBdi.toFixed(2)}",""`);
    rows.push(`"","","","","","","","","TOTAL COM BDI ${bdi}%","","${totalComBdi.toFixed(2)}"`);
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv;charset=utf-8;"}));a.download=`ORC_${obra?.nome?.replace(/[^a-zA-Z0-9]/g,"_").slice(0,20)||"orcamento"}_BDI${bdi}.csv`;a.click();
  };

  return (
    <div>
      <h1 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Orçamento</h1>
      <p style={{fontSize:13,color:"#6b7280",marginBottom:24}}>Consolide o orçamento com preços SINAPI por obra e disciplina.</p>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:12,marginBottom:20,alignItems:"end"}}>
        <div><label style={S.label}>Obra</label>
          <select style={S.input} value={obraId} onChange={e=>{setObraId(e.target.value);setPlantaId("");}}>
            <option value="">Selecione uma obra</option>
            {obras.map(o=><option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
        </div>
        <div><label style={S.label}>Planta (opcional)</label>
          <select style={S.input} value={plantaId} onChange={e=>setPlantaId(e.target.value)} disabled={!obra}>
            <option value="">Ver resumo da obra</option>
            {(obra?.plantas||[]).map(p=><option key={p.id} value={p.id}>{p.disciplina?`[${p.disciplina}] `:""}{p.fileName}</option>)}
          </select>
        </div>
        <div><label style={S.label}>BDI %</label>
          <input type="number" style={{...S.input,width:70}} value={bdi} onChange={e=>setBdi(Number(e.target.value))} min={0} max={100}/>
        </div>
      </div>

      {/* Resumo da obra por disciplina */}
      {obra&&!plantaId&&Object.keys(resumoObra).length>0&&(
        <div style={{...S.card,overflow:"hidden",marginBottom:20}}>
          <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <span style={{fontSize:13,fontWeight:600}}>{obra.nome} — Resumo por disciplina</span>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              {fatorMercado !== 1 && <span style={{fontSize:12,color:"#7c3aed",background:"#ede9fe",padding:"3px 10px",borderRadius:20}}>mercado {obra.fator_mercado}% SINAPI</span>}
              <span style={{fontSize:14,fontWeight:700,color:"#059669"}}>{fmtR(totalObra*(1+bdi/100))} <span style={{fontSize:11,fontWeight:400,color:"#6b7280"}}>c/ BDI {bdi}%</span></span>
              <button onClick={()=>exportarExcel(obra)} disabled={exportando} style={{...S.btnPrimary,padding:"6px 14px",fontSize:12,background:"#059669",opacity:exportando?0.6:1}}>
                {exportando?"⏳ Gerando...":"↓ Excel (.xlsx)"}
              </button>
            </div>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr>{["Disciplina","Plantas","Itens","Total sem BDI",`Total c/BDI ${bdi}%`,fatorMercado!==1?"Mercado (est.)":""].filter(Boolean).map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {Object.entries(resumoObra).map(([d,v],j)=>{
                const col=DISC_COR[d]||{};
                const nPlantas=(obra.plantas||[]).filter(p=>p.disciplina===d).length;
                return (
                  <tr key={j} style={{background:j%2===0?"#fff":"#fafafa"}}>
                    <td style={S.td}><span style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:col.bg||"#f3f4f6",color:col.text||"#374151",border:`1px solid ${col.border||"#e5e7eb"}`}}>{d}</span></td>
                    <td style={{...S.td,textAlign:"center"}}>{nPlantas}</td>
                    <td style={{...S.td,textAlign:"center"}}>{v.itens}</td>
                    <td style={{...S.td,textAlign:"right",fontWeight:600,color:"#059669"}}>{fmtR(v.total)}</td>
                    <td style={{...S.td,textAlign:"right",fontWeight:700,color:"#047857"}}>{fmtR(v.total*(1+bdi/100))}</td>
                    {fatorMercado!==1&&<td style={{...S.td,textAlign:"right",fontWeight:600,color:"#7c3aed"}}>{fmtR(v.total*fatorMercado*(1+bdi/100))}</td>}
                  </tr>
                );
              })}
              <tr style={{background:"#f0fdf4",borderTop:"2px solid #e5e7eb"}}>
                <td style={{...S.td,fontWeight:700}}>TOTAL OBRA</td>
                <td style={{...S.td,textAlign:"center",fontWeight:600}}>{(obra.plantas||[]).length}</td>
                <td style={{...S.td,textAlign:"center",fontWeight:600}}>{Object.values(resumoObra).reduce((s,v)=>s+v.itens,0)}</td>
                <td style={{...S.td,textAlign:"right",fontWeight:700,color:"#059669",fontSize:13}}>{fmtR(totalObra)}</td>
                <td style={{...S.td,textAlign:"right",fontWeight:800,color:"#047857",fontSize:15}}>{fmtR(totalObra*(1+bdi/100))}</td>
                {fatorMercado!==1&&<td style={{...S.td,textAlign:"right",fontWeight:800,color:"#7c3aed",fontSize:15}}>{fmtR(totalObra*fatorMercado*(1+bdi/100))}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {planta&&(
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
            {[{label:"Itens",valor:itens.length},{label:"Com preço",valor:`${comPreco.length}/${itens.length}`},{label:"Total sem BDI",valor:fmtR(totalSemBdi)},{label:`BDI ${bdi}%`,valor:fmtR(totalComBdi)}].map(c=>(
              <div key={c.label} style={{background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,color:"#6b7280",marginBottom:3}}>{c.label}</div>
                <div style={{fontSize:18,fontWeight:700}}>{c.valor}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
            <div style={{display:"flex",gap:8}}>
              <button onClick={exportar} style={S.btn}>↓ CSV</button>
              <button onClick={()=>exportarExcel(obra)} disabled={exportando} style={{...S.btnPrimary,background:"#059669",opacity:exportando?0.6:1}}>
                {exportando?"⏳ Gerando...":"↓ Excel (.xlsx)"}
              </button>
            </div>
          </div>
          <div style={{...S.card,overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr>{["Código","Descrição","Un.","Qtd.","SINAPI","Preço Unit.","Subtotal",`c/BDI ${bdi}%`].map((h,i)=>(
                  <th key={h} style={{...S.th,textAlign:[3,5,6,7].includes(i)?"right":"left"}}>{h}</th>
                ))}</tr></thead>
                <tbody>
                  {itens.map((it,j)=>{const sub=it.preco_sinapi?it.preco_sinapi*(it.qtd||0):null;return(
                    <tr key={j} style={{background:sub?"#f0fdf4":j%2===0?"#fff":"#fafafa"}}>
                      <td style={{...S.td,fontFamily:"monospace",fontSize:10,color:"#9ca3af"}}>{it.codigo_item}</td>
                      <td style={{...S.td,lineHeight:1.4}}>{it.descricao}</td>
                      <td style={{...S.td,textAlign:"center",color:"#6b7280"}}>{it.un}</td>
                      <td style={{...S.td,textAlign:"right",fontWeight:600}}>{fmt(it.qtd)}</td>
                      <td style={{...S.td,fontFamily:"monospace",fontSize:11,color:it.sinapi_sugerido?"#2563eb":"#d1d5db"}}>{it.sinapi_sugerido||"—"}</td>
                      <td style={{...S.td,textAlign:"right",color:it.preco_sinapi?"#059669":"#d1d5db"}}>{it.preco_sinapi?fmtR(it.preco_sinapi):"—"}</td>
                      <td style={{...S.td,textAlign:"right",fontWeight:600,color:sub?"#059669":"#d1d5db"}}>{sub!==null?fmtR(sub):"—"}</td>
                      <td style={{...S.td,textAlign:"right",fontWeight:700,color:sub?"#047857":"#d1d5db"}}>{sub!==null?fmtR(sub*(1+bdi/100)):"—"}</td>
                    </tr>
                  );})}
                </tbody>
                {totalSemBdi>0&&(
                  <tfoot>
                    <tr style={{background:"#f9fafb",borderTop:"2px solid #e5e7eb"}}>
                      <td colSpan={6} style={{...S.td,textAlign:"right",fontWeight:600}}>Total sem BDI</td>
                      <td style={{...S.td,textAlign:"right",fontWeight:700,color:"#059669",fontSize:13}}>{fmtR(totalSemBdi)}</td>
                      <td/>
                    </tr>
                    <tr style={{background:"#f0fdf4"}}>
                      <td colSpan={6} style={{...S.td,textAlign:"right",fontWeight:600}}>Total com BDI {bdi}%</td>
                      <td style={{...S.td,textAlign:"right",fontWeight:800,color:"#059669",fontSize:15}}>{fmtR(totalComBdi)}</td>
                      <td/>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {!obra&&(
        <div style={{textAlign:"center",padding:"60px 0",color:"#9ca3af"}}>
          <div style={{fontSize:36,marginBottom:8}}>💰</div>
          <div style={{fontSize:14}}>Selecione uma obra para ver o orçamento.</div>
        </div>
      )}
    </div>
  );
}

// Reservado — futura seção de histórico de obras concluídas
function SecaoGabarito({obras,gabaritos,setGabaritos}) {
  const [obraId,setObraId]     = useState("");
  const [carregando,setCarregando] = useState(false);
  const [erro,setErro]         = useState("");
  const [busca,setBusca]       = useState("");
  const fileRef = useRef();

  const obra      = obras.find(o=>o.id===obraId);
  const gabarito  = gabaritos[obraId] || null;

  const carregarExcel = async(file) => {
    if(!file || !obraId) return;
    setCarregando(true); setErro("");
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const resp = await fetch("/api/gabarito", { method:"POST", body:form });
      const data = await resp.json();
      if(data.error) throw new Error(data.error);
      setGabaritos(p=>({...p,[obraId]:{ ...data, carregadoEm: new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}), nomeArquivo: file.name }}));
    } catch(e) {
      setErro("Erro ao ler Excel: " + e.message);
    }
    setCarregando(false);
  };

  const removerGabarito = () => {
    if(!obraId) return;
    setGabaritos(p=>{ const n={...p}; delete n[obraId]; return n; });
  };

  const itensFiltrados = (gabarito?.itens || []).filter(i => {
    if(!busca) return true;
    return i.descricao.toLowerCase().includes(busca.toLowerCase()) ||
           i.codigo.toLowerCase().includes(busca.toLowerCase());
  });

  // Calcula totais da IA para comparação
  const totalIA = obra ? (obra.plantas||[]).reduce((s,p)=>(p.itens||[]).reduce((ss,i)=>ss+(i.preco_sinapi||0)*(i.qtd||0),ss),0) : 0;
  const fatorMercado = (obra?.fator_mercado || 100) / 100;

  return (
    <div>
      <h1 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Gabarito</h1>
      <p style={{fontSize:13,color:"#6b7280",marginBottom:24}}>Carregue o orçamento real aprovado para comparar com a extração da IA e calibrar futuras análises.</p>

      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:12,marginBottom:20,alignItems:"end"}}>
        <div><label style={S.label}>Obra</label>
          <select style={S.input} value={obraId} onChange={e=>setObraId(e.target.value)}>
            <option value="">Selecione uma obra</option>
            {obras.map(o=><option key={o.id} value={o.id}>{o.nome}{gabaritos[o.id]?" ✓":""}</option>)}
          </select>
        </div>
        {obraId&&(
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>fileRef.current?.click()} disabled={carregando} style={{...S.btnPrimary,padding:"8px 16px",fontSize:13}}>
              {carregando?"⏳ Carregando...":"📂 Carregar Excel"}
            </button>
            {gabarito&&<button onClick={removerGabarito} style={{...S.btn,fontSize:13,color:"#dc2626",borderColor:"#fecaca"}}>✕ Remover</button>}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={e=>{if(e.target.files[0])carregarExcel(e.target.files[0]);e.target.value="";}}/>
          </div>
        )}
      </div>

      {erro&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#dc2626"}}>{erro}</div>}

      {!obraId&&(
        <div style={{textAlign:"center",padding:"60px 0",color:"#9ca3af"}}>
          <div style={{fontSize:48,marginBottom:12}}>📊</div>
          <div style={{fontSize:15,fontWeight:600,marginBottom:6}}>Selecione uma obra para ver o gabarito</div>
          <div style={{fontSize:13}}>Carregue o Excel do orçamento executivo aprovado para comparar com a análise da IA e reduzir o erro.</div>
        </div>
      )}

      {obraId&&!gabarito&&(
        <div style={{...S.card,padding:32,textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:12}}>📤</div>
          <div style={{fontSize:15,fontWeight:600,marginBottom:8}}>Nenhum gabarito carregado para {obra?.nome}</div>
          <div style={{fontSize:13,color:"#6b7280",maxWidth:480,margin:"0 auto",marginBottom:16}}>
            Carregue o Excel do orçamento real executivo desta obra. O sistema irá parsear os itens e usá-los para calibrar automaticamente as próximas extrações de plantas desta obra.
          </div>
          <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"12px 16px",fontSize:12,color:"#0369a1",textAlign:"left",display:"inline-block"}}>
            <strong>Como funciona:</strong><br/>
            1. Carregue o Excel do orçamento aprovado<br/>
            2. O sistema detecta automaticamente as colunas (Descrição, Un, Qtd, Total)<br/>
            3. Os maiores itens são injetados no prompt da IA como referência de escala<br/>
            4. Quando a IA extrair uma quantidade muito diferente, ela revisará antes de retornar
          </div>
        </div>
      )}

      {gabarito&&(
        <div>
          {/* Painel de comparação */}
          {totalIA > 0 && (()=>{
            const diff = gabarito.total > 0 ? ((totalIA - gabarito.total) / gabarito.total * 100) : null;
            const diffM = gabarito.total > 0 ? ((totalIA * fatorMercado - gabarito.total) / gabarito.total * 100) : null;
            const corDiff = diff === null ? "#6b7280" : Math.abs(diff) <= 10 ? "#059669" : Math.abs(diff) <= 25 ? "#b45309" : "#dc2626";
            const corDiffM = diffM === null ? "#6b7280" : Math.abs(diffM) <= 10 ? "#059669" : Math.abs(diffM) <= 25 ? "#b45309" : "#dc2626";
            return (
              <div style={{...S.card,padding:16,marginBottom:16,background:"#f0f9ff",border:"1px solid #bae6fd"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#0369a1",marginBottom:12}}>📊 Comparação: IA vs Gabarito</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
                  {[
                    {label:"Gabarito real",valor:fmtR(gabarito.total),sub:`MAT: ${fmtR(gabarito.totalMat||0)} · MO: ${fmtR(gabarito.totalMO||0)}`,cor:"#374151"},
                    {label:"IA (SINAPI)",valor:fmtR(totalIA),sub:`${(obra?.plantas||[]).reduce((s,p)=>s+(p.itens?.length||0),0)} itens de ${(obra?.plantas||[]).length} plantas`,cor:"#059669"},
                    {label:`IA (mercado ${obra?.fator_mercado||100}%)`,valor:fmtR(totalIA*fatorMercado),sub:"SINAPI × fator de mercado",cor:"#7c3aed"},
                    {label:"Desvio SINAPI",valor:diff!==null?`${diff>=0?"+":""}${diff.toFixed(1)}%`:"—",sub:diff!==null?Math.abs(diff)<=10?"✓ dentro da meta ±10%":Math.abs(diff)<=25?"⚠ acima da meta":"✗ alto desvio":"—",cor:corDiff},
                    {label:"Desvio mercado",valor:diffM!==null?`${diffM>=0?"+":""}${diffM.toFixed(1)}%`:"—",sub:diffM!==null?Math.abs(diffM)<=10?"✓ dentro da meta ±10%":Math.abs(diffM)<=25?"⚠ acima da meta":"✗ alto desvio":"—",cor:corDiffM},
                  ].map(c=>(
                    <div key={c.label} style={{background:"#fff",border:"1px solid #e0f2fe",borderRadius:8,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:"#6b7280",marginBottom:3}}>{c.label}</div>
                      <div style={{fontSize:16,fontWeight:700,color:c.cor}}>{c.valor}</div>
                      <div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>{c.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Cabeçalho do gabarito */}
          <div style={{...S.card,overflow:"hidden",marginBottom:16}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontSize:13,fontWeight:600}}>{gabarito.nomeArquivo}</div>
                <div style={{fontSize:11,color:"#9ca3af"}}>Carregado em {gabarito.carregadoEm} · {gabarito.itens.length} itens · Abas: {(gabarito.sheets||[]).join(", ")}</div>
              </div>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <span style={{fontSize:13,fontWeight:700,color:"#059669"}}>Total: {fmtR(gabarito.total)}</span>
                {gabarito.totalMat > 0 && <span style={{fontSize:12,color:"#6b7280"}}>MAT: {fmtR(gabarito.totalMat)}</span>}
                {gabarito.totalMO > 0 && <span style={{fontSize:12,color:"#6b7280"}}>MO: {fmtR(gabarito.totalMO)}</span>}
              </div>
            </div>

            {/* Busca */}
            <div style={{padding:"10px 16px",borderBottom:"1px solid #e5e7eb"}}>
              <input style={{...S.input,fontSize:13}} value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Filtrar itens..."/>
            </div>

            <div style={{overflowX:"auto",maxHeight:500,overflowY:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead style={{position:"sticky",top:0}}>
                  <tr>{["Código","Descrição","Un","Qtd","Preço Unit.","Total","Seção"].map((h,i)=>(
                    <th key={h} style={{...S.th,textAlign:[3,4,5].includes(i)?"right":"left"}}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {itensFiltrados.map((it,j)=>(
                    <tr key={j} style={{background:j%2===0?"#fff":"#fafafa"}}>
                      <td style={{...S.td,fontFamily:"monospace",fontSize:10,color:"#9ca3af",whiteSpace:"nowrap"}}>{it.codigo||"—"}</td>
                      <td style={{...S.td,lineHeight:1.4,minWidth:220}}>{it.descricao}</td>
                      <td style={{...S.td,textAlign:"center",color:"#6b7280"}}>{it.un||"—"}</td>
                      <td style={{...S.td,textAlign:"right",fontWeight:600}}>{it.qtd > 0 ? fmt(it.qtd) : "—"}</td>
                      <td style={{...S.td,textAlign:"right",color:"#6b7280"}}>{it.preco_unit > 0 ? fmtR(it.preco_unit) : "—"}</td>
                      <td style={{...S.td,textAlign:"right",fontWeight:600,color:"#059669"}}>{it.total > 0 ? fmtR(it.total) : "—"}</td>
                      <td style={{...S.td}}><span style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:it.secao==="MAT"?"#dbeafe":it.secao==="MO"?"#dcfce7":"#f3f4f6",color:it.secao==="MAT"?"#1e40af":it.secao==="MO"?"#166534":"#374151"}}>{it.secao}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{background:"#f9fafb",borderTop:"2px solid #e5e7eb"}}>
                    <td colSpan={4} style={{...S.td,textAlign:"right",fontWeight:600}}>Total ({itensFiltrados.length} itens filtrados)</td>
                    <td/>
                    <td style={{...S.td,textAlign:"right",fontWeight:700,color:"#059669",fontSize:13}}>{fmtR(itensFiltrados.reduce((s,i)=>s+i.total,0))}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
