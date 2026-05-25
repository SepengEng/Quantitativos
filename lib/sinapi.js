// SINAPI Bahia — Referência Maio/2026 (Não Desonerada)
// Fonte: Caixa Econômica Federal / IBGE
// Itens selecionados para obras industriais, prediais e de infraestrutura

export const SINAPI_BA = [
  // ─── SERVIÇOS GERAIS ───────────────────────────────────────────────
  { codigo:"73965", grupo:"Serviços Gerais",    descricao:"ADMINISTRAÇÃO LOCAL DE OBRA",                                               un:"mês",  preco:8500.00 },
  { codigo:"73966", grupo:"Serviços Gerais",    descricao:"LIGAÇÃO PROVISÓRIA DE ÁGUA E ESGOTO",                                       un:"un",   preco:850.00  },
  { codigo:"73967", grupo:"Serviços Gerais",    descricao:"LIGAÇÃO PROVISÓRIA DE ENERGIA ELÉTRICA",                                    un:"un",   preco:1200.00 },
  { codigo:"73968", grupo:"Serviços Gerais",    descricao:"LIMPEZA FINAL DE OBRA",                                                     un:"m²",   preco:8.50   },

  // ─── TERRAPLENAGEM ─────────────────────────────────────────────────
  { codigo:"73970", grupo:"Terraplenagem",      descricao:"ESCAVAÇÃO MECÂNICA MAT. 1ª CATEGORIA — RETROESCAVADEIRA",                   un:"m³",   preco:8.45   },
  { codigo:"73971", grupo:"Terraplenagem",      descricao:"ESCAVAÇÃO MECÂNICA MAT. 2ª CATEGORIA — RETROESCAVADEIRA",                   un:"m³",   preco:12.80  },
  { codigo:"73972", grupo:"Terraplenagem",      descricao:"ATERRO COMPACTADO MECANICAMENTE (PROCTOR NORMAL)",                          un:"m³",   preco:14.20  },
  { codigo:"73973", grupo:"Terraplenagem",      descricao:"REGULARIZAÇÃO E COMPACTAÇÃO DE SUBGRADE",                                   un:"m²",   preco:4.85   },
  { codigo:"73974", grupo:"Terraplenagem",      descricao:"TRANSPORTE DE MATERIAL DE CORTE — DMT ATÉ 1KM",                             un:"m³",   preco:6.50   },
  { codigo:"73975", grupo:"Terraplenagem",      descricao:"REVESTIMENTO PRIMÁRIO DE TALUDE COM GRAMA EM PLACAS",                       un:"m²",   preco:18.40  },

  // ─── FUNDAÇÕES ─────────────────────────────────────────────────────
  { codigo:"74004", grupo:"Fundações",          descricao:"ESTACA RAIZ D=150MM, FURO E INJEÇÃO — COMPRIMENTO ATÉ 10M",                 un:"m",    preco:185.00 },
  { codigo:"74005", grupo:"Fundações",          descricao:"BLOCO DE COROAMENTO EM CONCRETO ARMADO FCK=25MPA",                          un:"m³",   preco:980.00 },
  { codigo:"74010", grupo:"Fundações",          descricao:"VIGA BALDRAME EM CONCRETO ARMADO FCK=20MPA",                               un:"m³",   preco:920.00 },

  // ─── ESTRUTURA CONCRETO ────────────────────────────────────────────
  { codigo:"96527", grupo:"Estrutura",          descricao:"CONCRETO USINADO BOMBEADO FCK=20MPA — LAJE/PISO",                           un:"m³",   preco:358.00 },
  { codigo:"96528", grupo:"Estrutura",          descricao:"CONCRETO USINADO BOMBEADO FCK=25MPA — ESTRUTURAL",                          un:"m³",   preco:385.00 },
  { codigo:"96529", grupo:"Estrutura",          descricao:"CONCRETO USINADO BOMBEADO FCK=30MPA — PILARES/VIGAS",                       un:"m³",   preco:415.00 },
  { codigo:"94965", grupo:"Estrutura",          descricao:"FÔRMA DE MADEIRA COMPENSADA — LAJES E VIGAS",                              un:"m²",   preco:52.00  },
  { codigo:"94966", grupo:"Estrutura",          descricao:"ARMAÇÃO AÇO CA-50 — CORTE, DOBRAMENTO E COLOCAÇÃO",                        un:"kg",   preco:9.80   },
  { codigo:"94967", grupo:"Estrutura",          descricao:"ARMAÇÃO AÇO CA-60",                                                         un:"kg",   preco:10.20  },
  { codigo:"96530", grupo:"Estrutura",          descricao:"LAJE STEEL DECK — FÔRMA INCORPORADA",                                      un:"m²",   preco:185.00 },

  // ─── ESTRUTURA METÁLICA ────────────────────────────────────────────
  { codigo:"98210", grupo:"Estrutura Metálica", descricao:"ESTRUTURA METÁLICA EM AÇO — GALPÃO INDUSTRIAL (PESO MÉDIO)",               un:"kg",   preco:18.50  },
  { codigo:"98211", grupo:"Estrutura Metálica", descricao:"COLUNA EM PERFIL LAMINADO I/H — FORNEC. E MONT.",                          un:"kg",   preco:19.80  },
  { codigo:"98212", grupo:"Estrutura Metálica", descricao:"VIGA EM PERFIL LAMINADO — FORNEC. E MONT.",                               un:"kg",   preco:18.20  },
  { codigo:"98213", grupo:"Estrutura Metálica", descricao:"TERÇA EM PERFIL Z OU U ENRIJECIDO",                                        un:"kg",   preco:16.50  },
  { codigo:"98214", grupo:"Estrutura Metálica", descricao:"PINTURA ANTICORROSIVA ESTRUTURA METÁLICA — 2 DEMÃOS",                      un:"m²",   preco:22.00  },

  // ─── ALVENARIA ─────────────────────────────────────────────────────
  { codigo:"87451", grupo:"Alvenaria",          descricao:"ALVENARIA BLOCO CERÂMICO FURADO 9X19X39CM — ESPESSURA 9CM",                un:"m²",   preco:45.80  },
  { codigo:"87452", grupo:"Alvenaria",          descricao:"ALVENARIA BLOCO CERÂMICO FURADO 14X19X39CM",                               un:"m²",   preco:58.40  },
  { codigo:"89714", grupo:"Alvenaria",          descricao:"ALVENARIA BLOCO CONCRETO ESTRUTURAL 11,5X19X39CM",                         un:"m²",   preco:62.50  },
  { codigo:"89715", grupo:"Alvenaria",          descricao:"ALVENARIA BLOCO CONCRETO ESTRUTURAL 14X19X39CM",                           un:"m²",   preco:72.30  },
  { codigo:"87886", grupo:"Alvenaria",          descricao:"VERGA E CONTRAVERGA EM CONCRETO ARMADO",                                   un:"m",    preco:28.50  },

  // ─── DRYWALL ───────────────────────────────────────────────────────
  { codigo:"90762", grupo:"Drywall",            descricao:"PAREDE DRYWALL — MONTANTE 48MM, PLACA ST 12,5MM (SIMPLES)",                un:"m²",   preco:88.50  },
  { codigo:"90763", grupo:"Drywall",            descricao:"PAREDE DRYWALL — MONTANTE 73MM, PLACA ST 12,5MM (SIMPLES)",                un:"m²",   preco:95.20  },
  { codigo:"90764", grupo:"Drywall",            descricao:"PAREDE DRYWALL — MONTANTE 48MM, PLACA RU 12,5MM (ÁREA MOLHADA)",           un:"m²",   preco:105.00 },
  { codigo:"90765", grupo:"Drywall",            descricao:"PAREDE DRYWALL — MONTANTE 73MM, PLACA RU 12,5MM (ÁREA MOLHADA)",           un:"m²",   preco:112.50 },
  { codigo:"90766", grupo:"Drywall",            descricao:"DIVISÓRIA DRYWALL ST 12MM — BOX BANHEIRO",                                 un:"m²",   preco:78.00  },

  // ─── REVESTIMENTOS PAREDES ─────────────────────────────────────────
  { codigo:"87530", grupo:"Revestimentos",      descricao:"CHAPISCO ARGAMASSA CIMENTO E AREIA TRAÇO 1:3 — E=5MM",                     un:"m²",   preco:9.20   },
  { codigo:"87529", grupo:"Revestimentos",      descricao:"REBOCO ARGAMASSA TRAÇO 1:2:9 — E=20MM",                                   un:"m²",   preco:24.50  },
  { codigo:"87546", grupo:"Revestimentos",      descricao:"REBOCO HIDRÓFUGO EXTERNO — ARGAMASSA PRÉ-FABRICADA E=3CM",                 un:"m²",   preco:32.80  },
  { codigo:"87264", grupo:"Revestimentos",      descricao:"REVESTIMENTO CERÂMICO PAREDE — ARGAMASSA AC-3, PEÇA ATÉ 30X30CM",          un:"m²",   preco:48.50  },
  { codigo:"87265", grupo:"Revestimentos",      descricao:"REVESTIMENTO CERÂMICO PAREDE — ARGAMASSA AC-3, PEÇA 30X60CM",              un:"m²",   preco:55.20  },
  { codigo:"87266", grupo:"Revestimentos",      descricao:"REVESTIMENTO CERÂMICO PAREDE — ARGAMASSA AC-3, PEÇA 10X10CM",              un:"m²",   preco:52.00  },
  { codigo:"87880/002", grupo:"Revestimentos",      descricao:"PINTURA LÁTEX ACRÍLICA — 2 DEMÃOS SOBRE MASSA CORRIDA PVA",               un:"m²",   preco:19.80  },
  { codigo:"87881", grupo:"Revestimentos",      descricao:"PINTURA ACRÍLICA — 2 DEMÃOS SOBRE MASSA CORRIDA ACRÍLICA",                un:"m²",   preco:22.50  },
  { codigo:"87882", grupo:"Revestimentos",      descricao:"MASSA CORRIDA BASE PVA INTERNA — 2 DEMÃOS",                               un:"m²",   preco:12.80  },

  // ─── PISOS ─────────────────────────────────────────────────────────
  { codigo:"87878", grupo:"Pisos",              descricao:"CONTRAPISO ARGAMASSA DE CIMENTO E AREIA — E=3CM",                          un:"m²",   preco:36.50  },
  { codigo:"87879", grupo:"Pisos",              descricao:"PISO CIMENTADO SARRAFEADO — E=3CM",                                       un:"m²",   preco:28.50  },
  { codigo:"87893", grupo:"Pisos",              descricao:"PORCELANATO RETIFICADO 60X60CM — ÁREA SECA, AC-3",                         un:"m²",   preco:88.50  },
  { codigo:"87894", grupo:"Pisos",              descricao:"PORCELANATO RETIFICADO 60X60CM — ÁREA MOLHADA, AC-3",                      un:"m²",   preco:98.50  },
  { codigo:"87895", grupo:"Pisos",              descricao:"PISO CERÂMICO ESMALTADO 45X45CM — PEI-4",                                 un:"m²",   preco:65.80  },
  { codigo:"87896", grupo:"Pisos",              descricao:"RODAPÉ CERÂMICO 7X45CM — ASSENT. ARGAMASSA AC-1",                         un:"m",    preco:18.50  },
  { codigo:"98000", grupo:"Pisos",              descricao:"PASSEIO EM CONCRETO FCK=20MPA E=8CM",                                     un:"m²",   preco:72.00  },
  { codigo:"98001", grupo:"Pisos",              descricao:"PISO INDUSTRIAL CONCRETO FCK=25MPA E=10CM — C/ FIBRAS",                   un:"m²",   preco:95.00  },
  { codigo:"98002", grupo:"Pisos",              descricao:"SOLEIRA GRANITO CINZA ANDORINHA — ASSENT. ARGAMASSA",                     un:"m",    preco:85.00  },

  // ─── IMPERMEABILIZAÇÃO ─────────────────────────────────────────────
  { codigo:"88497", grupo:"Impermeabilização",  descricao:"IMPERMEABILIZAÇÃO MANTA ASFÁLTICA 3MM — SOBRE CAMADA REG.",               un:"m²",   preco:58.50  },
  { codigo:"88498", grupo:"Impermeabilização",  descricao:"IMPERMEABILIZAÇÃO MANTA ASFÁLTICA 4MM — SOBRE CAMADA REG.",               un:"m²",   preco:68.50  },
  { codigo:"88499", grupo:"Impermeabilização",  descricao:"IMPERMEABILIZAÇÃO ARGAMASSA POLIMÉRICA — 3 DEMÃOS",                       un:"m²",   preco:42.00  },

  // ─── COBERTURA ─────────────────────────────────────────────────────
  { codigo:"88500", grupo:"Cobertura",          descricao:"TELHA FIBROCIMENTO ONDULADA 6MM — 1,10X1,53M (FORNEC. E MONT.)",           un:"m²",   preco:48.50  },
  { codigo:"88501", grupo:"Cobertura",          descricao:"TELHA METÁLICA TRAPEZOIDAL — FORNEC. E MONT.",                            un:"m²",   preco:85.00  },
  { codigo:"88502", grupo:"Cobertura",          descricao:"CUMEEIRA FIBROCIMENTO — FORNEC. E MONT.",                                 un:"m",    preco:38.50  },
  { codigo:"88503", grupo:"Cobertura",          descricao:"TERÇA EM MADEIRA APARELHADA 6X12CM",                                     un:"m",    preco:28.50  },
  { codigo:"88504", grupo:"Cobertura",          descricao:"RUFOS E CALHAS EM CHAPA GALVANIZADA — FORNEC. E MONT.",                   un:"m",    preco:55.00  },
  { codigo:"88505", grupo:"Cobertura",          descricao:"FORRO EM GESSO ACARTONADO REMOVÍVEL — PERFIL T SUSPENSO",                 un:"m²",   preco:68.50  },
  { codigo:"88506", grupo:"Cobertura",          descricao:"CHAPIM EM CONCRETO PRÉ-MOLDADO — TOPO DE PAREDES",                        un:"m",    preco:32.00  },

  // ─── ESQUADRIAS ────────────────────────────────────────────────────
  { codigo:"88510", grupo:"Esquadrias",         descricao:"PORTA MADEIRA SEMI-OCA 0,70X2,10M — FORNEC. E MONT.",                    un:"un",   preco:285.00 },
  { codigo:"88511", grupo:"Esquadrias",         descricao:"PORTA MADEIRA SEMI-OCA 0,80X2,10M — FORNEC. E MONT.",                    un:"un",   preco:315.00 },
  { codigo:"88512", grupo:"Esquadrias",         descricao:"PORTA MADEIRA 0,90X2,10M C/ BARRA ANTIPÂNICO",                           un:"un",   preco:780.00 },
  { codigo:"88513", grupo:"Esquadrias",         descricao:"PORTA CORRER MADEIRA 0,80X2,10M",                                        un:"un",   preco:380.00 },
  { codigo:"88514", grupo:"Esquadrias",         descricao:"PORTA VIDRO TEMPERADO 8MM 2 FOLHAS ABRIR — C/ MOLA",                     un:"un",   preco:1250.00},
  { codigo:"88515", grupo:"Esquadrias",         descricao:"PORTA TS LAMINADO 0,60X1,60M — SHAFT/DRYWALL",                           un:"un",   preco:320.00 },
  { codigo:"88520", grupo:"Esquadrias",         descricao:"JANELA CORRER ALUMÍNIO 4 FOLHAS VIDRO TEMP. 2,00X1,20M",                  un:"un",   preco:785.00 },
  { codigo:"88521", grupo:"Esquadrias",         descricao:"JANELA MAXIM-AR ALUMÍNIO 1 FOLHA 0,60X0,60M",                            un:"un",   preco:185.00 },
  { codigo:"88522", grupo:"Esquadrias",         descricao:"JANELA MAXIM-AR ALUMÍNIO 2 FOLHAS 1,20X0,60M",                           un:"un",   preco:320.00 },
  { codigo:"88523", grupo:"Esquadrias",         descricao:"JANELA CORRER ALUMÍNIO 2 FOLHAS 1,00X1,40M",                             un:"un",   preco:420.00 },
  { codigo:"88524", grupo:"Esquadrias",         descricao:"PEITORIL GRANITO CINZA ANDORINHA — ASSENT. ARGAMASSA",                   un:"m",    preco:95.00  },

  // ─── HIDRÁULICA — ÁGUA FRIA ────────────────────────────────────────
  { codigo:"89837", grupo:"Hidráulica",         descricao:"TUBO PVC RÍGIDO SOLDÁVEL ø25MM — ÁGUA FRIA",                              un:"m",    preco:18.50  },
  { codigo:"89838", grupo:"Hidráulica",         descricao:"TUBO PVC RÍGIDO SOLDÁVEL ø32MM — ÁGUA FRIA",                              un:"m",    preco:24.50  },
  { codigo:"89839", grupo:"Hidráulica",         descricao:"TUBO PVC RÍGIDO SOLDÁVEL ø50MM — ÁGUA FRIA",                              un:"m",    preco:38.50  },
  { codigo:"89840", grupo:"Hidráulica",         descricao:"TUBO PVC RÍGIDO SOLDÁVEL ø75MM — ÁGUA FRIA",                              un:"m",    preco:58.00  },
  { codigo:"89841", grupo:"Hidráulica",         descricao:"TUBO PVC RÍGIDO SOLDÁVEL ø100MM — ÁGUA FRIA",                             un:"m",    preco:82.50  },
  { codigo:"89842", grupo:"Hidráulica",         descricao:"REGISTRO GAVETA BRUTO ø25MM",                                             un:"un",   preco:28.50  },
  { codigo:"89843", grupo:"Hidráulica",         descricao:"REGISTRO GAVETA BRUTO ø50MM",                                             un:"un",   preco:65.00  },

  // ─── HIDRÁULICA — ESGOTO/PLUVIAL ──────────────────────────────────
  { codigo:"89850", grupo:"Pluvial/Esgoto",     descricao:"TUBO PVC SÉRIE NORMAL ø50MM — ESGOTO",                                   un:"m",    preco:22.50  },
  { codigo:"89851", grupo:"Pluvial/Esgoto",     descricao:"TUBO PVC SÉRIE NORMAL ø75MM — ESGOTO",                                   un:"m",    preco:32.50  },
  { codigo:"89852", grupo:"Pluvial/Esgoto",     descricao:"TUBO PVC SÉRIE NORMAL ø100MM — ESGOTO/PLUVIAL",                          un:"m",    preco:45.50  },
  { codigo:"89853", grupo:"Pluvial/Esgoto",     descricao:"TUBO PVC SÉRIE REFORÇADA ø100MM — PLUVIAL",                              un:"m",    preco:58.50  },
  { codigo:"89854", grupo:"Pluvial/Esgoto",     descricao:"TUBO PVC SÉRIE REFORÇADA ø150MM — PLUVIAL",                              un:"m",    preco:92.00  },
  { codigo:"89855", grupo:"Pluvial/Esgoto",     descricao:"JOELHO 90° PVC SR ø100MM — PLUVIAL",                                     un:"un",   preco:12.50  },
  { codigo:"89856", grupo:"Pluvial/Esgoto",     descricao:"TÊ PVC SR ø100X100MM — PLUVIAL",                                         un:"un",   preco:18.50  },
  { codigo:"89857", grupo:"Pluvial/Esgoto",     descricao:"RALO CIRCULAR PVC ø100MM — PLUVIAL",                                     un:"un",   preco:35.00  },
  { codigo:"89858", grupo:"Pluvial/Esgoto",     descricao:"CAIXA INSPEÇÃO CONCRETO 60X60CM — FORNEC. E ASSENT.",                    un:"un",   preco:185.00 },
  { codigo:"89859", grupo:"Pluvial/Esgoto",     descricao:"CAIXA GORDURA CONCRETO 20X30CM",                                         un:"un",   preco:95.00  },

  // ─── TUBULAÇÃO INDUSTRIAL ─────────────────────────────────────────
  { codigo:"74156", grupo:"Tubulação Industrial",descricao:"TUBO AÇO CARBONO SOLD. ø1\" (25MM) — FORNEC. E MONT.",                   un:"m",    preco:88.50  },
  { codigo:"74157", grupo:"Tubulação Industrial",descricao:"TUBO AÇO CARBONO SOLD. ø2\" (50MM) — FORNEC. E MONT.",                   un:"m",    preco:148.00 },
  { codigo:"74158", grupo:"Tubulação Industrial",descricao:"TUBO AÇO CARBONO SOLD. ø3\" (75MM) — FORNEC. E MONT.",                   un:"m",    preco:220.00 },
  { codigo:"74159", grupo:"Tubulação Industrial",descricao:"TUBO AÇO CARBONO SOLD. ø4\" (100MM) — FORNEC. E MONT.",                  un:"m",    preco:295.00 },
  { codigo:"74160", grupo:"Tubulação Industrial",descricao:"TUBO AÇO CARBONO SOLD. ø6\" (150MM) — FORNEC. E MONT.",                  un:"m",    preco:485.00 },
  { codigo:"74161", grupo:"Tubulação Industrial",descricao:"TUBO COBRE ø15MM — GÁS/FLUIDO INDUSTRIAL",                               un:"m",    preco:58.00  },
  { codigo:"74162", grupo:"Tubulação Industrial",descricao:"TUBO COBRE ø28MM — GÁS/FLUIDO INDUSTRIAL",                               un:"m",    preco:95.00  },
  { codigo:"74163", grupo:"Tubulação Industrial",descricao:"VÁLVULA ESFERA AÇO INOX ø1\" — LINHA INDUSTRIAL",                        un:"un",   preco:185.00 },
  { codigo:"74164", grupo:"Tubulação Industrial",descricao:"VÁLVULA ESFERA AÇO INOX ø2\" — LINHA INDUSTRIAL",                        un:"un",   preco:380.00 },
  { codigo:"74165", grupo:"Tubulação Industrial",descricao:"SUPORTE TIPO SELA — TUBULAÇÃO AÉREA ATÉ 2\"",                             un:"un",   preco:28.50  },
  { codigo:"74166", grupo:"Tubulação Industrial",descricao:"ISOLAMENTO TÉRMICO EM LÃ DE ROCHA — TUBULAÇÃO",                          un:"m",    preco:48.00  },

  // ─── ELÉTRICA ──────────────────────────────────────────────────────
  { codigo:"91911", grupo:"Elétrica",           descricao:"ELETRODUTO PVC RÍGIDO ø25MM — FORNEC. E INST.",                           un:"m",    preco:15.80  },
  { codigo:"91912", grupo:"Elétrica",           descricao:"ELETRODUTO PVC RÍGIDO ø32MM — FORNEC. E INST.",                           un:"m",    preco:19.50  },
  { codigo:"91913", grupo:"Elétrica",           descricao:"ELETRODUTO PVC RÍGIDO ø50MM — FORNEC. E INST.",                           un:"m",    preco:28.50  },
  { codigo:"91914", grupo:"Elétrica",           descricao:"ELETRODUTO METÁLICO RÍGIDO ø1\" — AREA INDUSTRIAL",                       un:"m",    preco:32.00  },
  { codigo:"91925", grupo:"Elétrica",           descricao:"CABO COBRE FLEXÍVEL 2,5MM² — 750V",                                       un:"m",    preco:8.80   },
  { codigo:"91926", grupo:"Elétrica",           descricao:"CABO COBRE FLEXÍVEL 4MM² — 750V",                                         un:"m",    preco:12.50  },
  { codigo:"91927", grupo:"Elétrica",           descricao:"CABO COBRE FLEXÍVEL 6MM² — 750V",                                         un:"m",    preco:18.50  },
  { codigo:"91928", grupo:"Elétrica",           descricao:"CABO COBRE FLEXÍVEL 10MM² — 750V",                                        un:"m",    preco:29.50  },
  { codigo:"91929", grupo:"Elétrica",           descricao:"CABO COBRE FLEXÍVEL 16MM²",                                               un:"m",    preco:46.00  },
  { codigo:"91935", grupo:"Elétrica",           descricao:"BANDEJA ELETROCALHA AÇO GALV. 100X50MM",                                  un:"m",    preco:58.00  },
  { codigo:"91936", grupo:"Elétrica",           descricao:"BANDEJA ELETROCALHA AÇO GALV. 200X50MM",                                  un:"m",    preco:85.00  },
  { codigo:"91940", grupo:"Elétrica",           descricao:"TOMADA 2P+T 20A — FORNEC. E INST.",                                       un:"un",   preco:45.00  },
  { codigo:"91941", grupo:"Elétrica",           descricao:"INTERRUPTOR SIMPLES 10A — FORNEC. E INST.",                               un:"un",   preco:35.00  },
  { codigo:"91945", grupo:"Elétrica",           descricao:"LUMINÁRIA LED SOBREPOR 40W — FORNEC. E INST.",                            un:"un",   preco:185.00 },
  { codigo:"91946", grupo:"Elétrica",           descricao:"LUMINÁRIA LED INDUSTRIAL 100W — HIGH BAY",                                un:"un",   preco:380.00 },
  { codigo:"91950", grupo:"Elétrica",           descricao:"QUADRO DISTRIBUIÇÃO 12 DISJUNTORES — FORNEC. E INST.",                    un:"un",   preco:650.00 },
  { codigo:"91951", grupo:"Elétrica",           descricao:"DISJUNTOR BIPOLAR 20A — FORNEC. E INST.",                                 un:"un",   preco:65.00  },
  { codigo:"91952", grupo:"Elétrica",           descricao:"DISJUNTOR TRIPOLAR 40A — FORNEC. E INST.",                                un:"un",   preco:125.00 },
  { codigo:"91960", grupo:"Elétrica",           descricao:"ATERRAMENTO — HASTE COBRE 3/4\" L=2,4M",                                  un:"un",   preco:185.00 },

  // ─── HVAC ──────────────────────────────────────────────────────────
  { codigo:"88315", grupo:"HVAC",               descricao:"SPLIT HI-WALL 9.000 BTU/H — FORNEC., INST. E CARGA GÁS",                  un:"un",   preco:1950.00},
  { codigo:"88316", grupo:"HVAC",               descricao:"SPLIT HI-WALL 12.000 BTU/H — FORNEC., INST. E CARGA GÁS",                 un:"un",   preco:2200.00},
  { codigo:"88317", grupo:"HVAC",               descricao:"SPLIT HI-WALL 18.000 BTU/H — FORNEC., INST. E CARGA GÁS",                 un:"un",   preco:2950.00},
  { codigo:"88318", grupo:"HVAC",               descricao:"SPLIT HI-WALL 24.000 BTU/H — FORNEC., INST. E CARGA GÁS",                 un:"un",   preco:3650.00},
  { codigo:"88319", grupo:"HVAC",               descricao:"SPLIT CASSETE 36.000 BTU/H — FORNEC., INST. E CARGA GÁS",                 un:"un",   preco:6800.00},
  { codigo:"88320", grupo:"HVAC",               descricao:"DUTO CHAPA GALVANIZADA — SEÇÃO RET. ATÉ 0,5M²",                           un:"m²",   preco:185.00 },
  { codigo:"88321", grupo:"HVAC",               descricao:"DIFUSOR DE AR INSUFLAMENTO 300X300MM",                                    un:"un",   preco:185.00 },

  // ─── LOUÇAS E METAIS ───────────────────────────────────────────────
  { codigo:"86896", grupo:"Louças e Metais",    descricao:"BACIA SANITÁRIA C/ CAIXA ACOPLADA — FORNEC. E INST.",                     un:"un",   preco:485.00 },
  { codigo:"86897", grupo:"Louças e Metais",    descricao:"LAVATÓRIO LOUÇA COM COLUNA — FORNEC. E INST.",                            un:"un",   preco:285.00 },
  { codigo:"86898", grupo:"Louças e Metais",    descricao:"TANQUE LOUÇA 28 LITROS — FORNEC. E INST.",                               un:"un",   preco:320.00 },
  { codigo:"86899", grupo:"Louças e Metais",    descricao:"CUBA EMBUTIR AÇO INOX 47X30CM — FORNEC. E INST.",                        un:"un",   preco:285.00 },
  { codigo:"86900", grupo:"Louças e Metais",    descricao:"CUBA EMBUTIR REDONDA LOUÇA — FORNEC. E INST.",                           un:"un",   preco:220.00 },
  { codigo:"86905", grupo:"Louças e Metais",    descricao:"TORNEIRA LAVATÓRIO MESA — LINHA ECOPRESS",                               un:"un",   preco:165.00 },
  { codigo:"86906", grupo:"Louças e Metais",    descricao:"TORNEIRA COZINHA — FORNEC. E INST.",                                     un:"un",   preco:185.00 },
  { codigo:"86907", grupo:"Louças e Metais",    descricao:"TORNEIRA JARDIM EXTERNA — FORNEC. E INST.",                              un:"un",   preco:45.00  },
  { codigo:"86910", grupo:"Louças e Metais",    descricao:"DUCHA HIGIÊNICA — FORNEC. E INST.",                                      un:"un",   preco:95.00  },

  // ─── GÁS NATURAL ──────────────────────────────────────────────────
  { codigo:"74200", grupo:"Gás Natural",        descricao:"TUBO COBRE RÍGIDO ø15MM — REDE GÁS NATURAL",                             un:"m",    preco:62.00  },
  { codigo:"74201", grupo:"Gás Natural",        descricao:"TUBO COBRE RÍGIDO ø22MM — REDE GÁS NATURAL",                             un:"m",    preco:98.00  },
  { codigo:"74202", grupo:"Gás Natural",        descricao:"TUBO POLIETILENO PEAD ø63MM — REDE GÁS EXTERNO",                         un:"m",    preco:48.00  },
  { codigo:"74203", grupo:"Gás Natural",        descricao:"REGULADOR PRESSÃO GÁS 1ª FASE",                                          un:"un",   preco:380.00 },
  { codigo:"74204", grupo:"Gás Natural",        descricao:"VÁLVULA ESFERA LATÃO ø1/2\" — RAMAL GÁS",                                 un:"un",   preco:45.00  },
  { codigo:"74205", grupo:"Gás Natural",        descricao:"TESTE ESTANQUEIDADE REDE GÁS",                                           un:"un",   preco:250.00 },

  // ─── INCÊNDIO ─────────────────────────────────────────────────────────────────
  { codigo:"74300", grupo:"Incêndio", descricao:"SPRINKLER PENDANT 1/2\" — FORNEC. E INST.", un:"un", preco:45.00 },
  { codigo:"74301", grupo:"Incêndio", descricao:"SPRINKLER UPRIGHT 1/2\" — FORNEC. E INST.", un:"un", preco:45.00 },
  { codigo:"74310", grupo:"Incêndio", descricao:"HIDRANTE TIPO 2 — ABRIGO, MANGUEIRA E ESGUICHO", un:"un", preco:1850.00 },
  { codigo:"74311", grupo:"Incêndio", descricao:"MANGUEIRA INCÊNDIO 2.1/2\" L=15M", un:"un", preco:380.00 },
  { codigo:"74320", grupo:"Incêndio", descricao:"DETECTOR DE FUMAÇA ENDEREÇÁVEL — FORNEC. E INST.", un:"un", preco:285.00 },
  { codigo:"74323", grupo:"Incêndio", descricao:"CENTRAL DE ALARME DE INCÊNDIO — FORNEC. E INST.", un:"un", preco:4500.00 },
  { codigo:"74330", grupo:"Incêndio", descricao:"PLACA DE SINALIZAÇÃO FOTOLUMINESCENTE — FORNEC. E INST.", un:"un", preco:35.00 },
  { codigo:"74340", grupo:"Incêndio", descricao:"EXTINTOR CO2 6KG — FORNEC. E INST.", un:"un", preco:420.00 },
  { codigo:"74341", grupo:"Incêndio", descricao:"EXTINTOR PÓ ABC 6KG — FORNEC. E INST.", un:"un", preco:180.00 },
  // ─── HVAC COMPLEMENTAR ────────────────────────────────────────────────────────
  { codigo:"88322", grupo:"HVAC", descricao:"DUTO FLEXÍVEL — FORNEC. E INST.", un:"m", preco:55.00 },
  { codigo:"88323", grupo:"HVAC", descricao:"GRELHA DE RETORNO — FORNEC. E INST.", un:"un", preco:85.00 },
  { codigo:"88330", grupo:"HVAC", descricao:"CHILLER 30TR — FORNEC. E INST.", un:"un", preco:48000.00 },
  { codigo:"88331", grupo:"HVAC", descricao:"FAN-COIL — FORNEC. E INST.", un:"un", preco:3200.00 },
  { codigo:"88335", grupo:"HVAC", descricao:"ISOLAMENTO ELASTÔMERO DUTO — FORNEC. E INST.", un:"m²", preco:95.00 },
  // ─── HIDRÁULICA COMPLEMENTAR ──────────────────────────────────────────────────
  { codigo:"89870", grupo:"Hidráulica", descricao:"RALO SIFONADO 100MM — FORNEC. E INST.", un:"un", preco:48.00 },
  { codigo:"89871", grupo:"Hidráulica", descricao:"CAIXA SIFONADA 150X150MM — FORNEC. E INST.", un:"un", preco:65.00 },
  // ─── ELÉTRICA/SPDA COMPLEMENTAR ───────────────────────────────────────────────
  { codigo:"91947", grupo:"Elétrica", descricao:"ILUMINAÇÃO DE EMERGÊNCIA BLOCO AUTÔNOMO 30MIN — FORNEC. E INST.", un:"un", preco:285.00 },
  { codigo:"91961", grupo:"SPDA", descricao:"CABO COBRE NU 50MM² — FORNEC. E INST.", un:"m", preco:48.00 },
  { codigo:"91962", grupo:"SPDA", descricao:"CAIXA DE INSPEÇÃO SPDA — FORNEC. E INST.", un:"un", preco:185.00 },
  { codigo:"91963", grupo:"SPDA", descricao:"CAPTOR FRANKLIN — FORNEC. E INST.", un:"un", preco:850.00 },
  { codigo:"91965", grupo:"SPDA", descricao:"DPS CLASSE II — FORNEC. E INST.", un:"un", preco:320.00 },
  { codigo:"91967", grupo:"SPDA", descricao:"CABO COBRE NU 35MM² — FORNEC. E INST.", un:"m", preco:32.00 },
  { codigo:"91968", grupo:"SPDA", descricao:"CABO COBRE NU 70MM² — FORNEC. E INST.", un:"m", preco:65.00 },
  // ─── CFTV / DADOS E VOZ ───────────────────────────────────────────────────────
  { codigo:"91970", grupo:"CFTV", descricao:"CABO UTP CAT6 — FORNEC. E INST.", un:"m", preco:8.50 },
  { codigo:"91971", grupo:"CFTV", descricao:"CABO COAXIAL RG59 — FORNEC. E INST.", un:"m", preco:6.50 },
  { codigo:"91972", grupo:"Dados e Voz", descricao:"CABO FIBRA ÓPTICA SM 6FO — FORNEC. E INST.", un:"m", preco:18.50 },
  { codigo:"91973", grupo:"Dados e Voz", descricao:"CABO UTP CAT6A — FORNEC. E INST.", un:"m", preco:12.50 },
  { codigo:"91975", grupo:"CFTV", descricao:"NVR 16 CANAIS — FORNEC. E INST.", un:"un", preco:3500.00 },
  { codigo:"91980", grupo:"Dados e Voz", descricao:"RACK 12U — FORNEC. E INST.", un:"un", preco:850.00 },
  { codigo:"91981", grupo:"Dados e Voz", descricao:"PATCH PANEL CAT6 24P — FORNEC. E INST.", un:"un", preco:380.00 },
  { codigo:"91982", grupo:"Dados e Voz", descricao:"SWITCH 24P — FORNEC. E INST.", un:"un", preco:1200.00 },
  { codigo:"91983", grupo:"Dados e Voz", descricao:"RACK 24U — FORNEC. E INST.", un:"un", preco:1400.00 },
  { codigo:"91984", grupo:"Dados e Voz", descricao:"TOMADA RJ45 CAT6 — FORNEC. E INST.", un:"un", preco:45.00 },


  // ─── TUBULAÇÃO PPR (projetos BYD/industriais) ────────────────────────────────
  { codigo:"89861", grupo:"Hidráulica", descricao:"TUBO PPR PN20 Ø20MM — ÁGUA FRIA POTÁVEL", un:"m", preco:28.50 },
  { codigo:"89862", grupo:"Hidráulica", descricao:"TUBO PPR PN20 Ø25MM — ÁGUA FRIA POTÁVEL", un:"m", preco:32.00 },
  { codigo:"89863", grupo:"Hidráulica", descricao:"TUBO PPR PN20 Ø32MM — ÁGUA FRIA POTÁVEL", un:"m", preco:42.00 },
  { codigo:"89864", grupo:"Hidráulica", descricao:"TUBO PPR PN20 Ø40MM — ÁGUA FRIA POTÁVEL", un:"m", preco:58.00 },
  { codigo:"89865", grupo:"Hidráulica", descricao:"TUBO PPR PN20 Ø50MM — ÁGUA FRIA POTÁVEL", un:"m", preco:75.00 },
  { codigo:"89866", grupo:"Hidráulica", descricao:"CAIXA SECA Ø40MM — DRENO HVAC", un:"un", preco:38.00 },
  // ─── ESTRUTURA METÁLICA INDUSTRIAL ──────────────────────────────────────────
  { codigo:"98212", grupo:"Estrutura Metálica", descricao:"VIGA EM PERFIL LAMINADO — FORNEC. E MONT.", un:"kg", preco:18.20 },
  { codigo:"98213", grupo:"Estrutura Metálica", descricao:"TERÇA EM PERFIL Z OU U ENRIJECIDO", un:"kg", preco:16.50 },
  { codigo:"98215", grupo:"Estrutura Metálica", descricao:"CHUMBADOR DE ANCORAGEM M24 — FORNEC. E INST.", un:"un", preco:45.00 },
  { codigo:"98216", grupo:"Estrutura Metálica", descricao:"CHUMBADOR DE ANCORAGEM M27 — FORNEC. E INST.", un:"un", preco:58.00 },
  { codigo:"98217", grupo:"Estrutura Metálica", descricao:"BASE DE COLUNA METÁLICA — CHAPA E SOLDA", un:"un", preco:850.00 },
  { codigo:"98218", grupo:"Estrutura Metálica", descricao:"CONTRAVENTAMENTO DIAGONAL — TIRANTE AÇO", un:"kg", preco:22.00 },
  { codigo:"98219", grupo:"Estrutura Metálica", descricao:"TELHA METÁLICA TRAPEZOIDAL — FORNEC. E MONT.", un:"m²", preco:85.00 },
  { codigo:"98220", grupo:"Estrutura Metálica", descricao:"PAINEL METÁLICO (WALL PANEL) — FECHAMENTO LATERAL", un:"m²", preco:125.00 },
  { codigo:"98221", grupo:"Estrutura Metálica", descricao:"PINTURA ZARCÃO + ESMALTE ESTRUTURA METÁLICA", un:"m²", preco:28.00 },
  { codigo:"98222", grupo:"Estrutura Metálica", descricao:"GALVANIZAÇÃO A FOGO — ESTRUTURA METÁLICA", un:"kg", preco:8.50 },
  // ─── ESCADAS METÁLICAS ────────────────────────────────────────────────────────
  { codigo:"98230", grupo:"Estrutura Metálica", descricao:"ESCADA METÁLICA EM AÇO CARBONO — FORNEC. E MONT.", un:"kg", preco:25.00 },
  { codigo:"98231", grupo:"Estrutura Metálica", descricao:"ESCADA MARINHEIRO (VERTICAL) — AÇO GALV.", un:"m", preco:380.00 },
  { codigo:"98232", grupo:"Estrutura Metálica", descricao:"CORRIMÃO EM AÇO INOXIDÁVEL — FORNEC. E MONT.", un:"m", preco:285.00 },
  { codigo:"98233", grupo:"Estrutura Metálica", descricao:"GUARDA-CORPO METÁLICO — AÇO CARBONO PINTADO", un:"m", preco:220.00 },
  // ─── ELÉTRICA INDUSTRIAL ─────────────────────────────────────────────────────
  { codigo:"91914", grupo:"Elétrica", descricao:"ELETRODUTO METÁLICO RÍGIDO Ø1\" — ÁREA INDUSTRIAL", un:"m", preco:32.00 },
  { codigo:"91915", grupo:"Elétrica", descricao:"ELETRODUTO METÁLICO RÍGIDO Ø1.1/2\" — ÁREA INDUSTRIAL", un:"m", preco:42.00 },
  { codigo:"91916", grupo:"Elétrica", descricao:"PERFILADO AÇO GALVANIZADO 38X38MM", un:"m", preco:28.00 },
  { codigo:"91917", grupo:"Elétrica", descricao:"POSTE ARTICULÁVEL EXTERNO — LUMINÁRIA", un:"un", preco:1850.00 },
  { codigo:"91953", grupo:"Elétrica", descricao:"DISJUNTOR MONOPOLAR 16A — FORNEC. E INST.", un:"un", preco:45.00 },
  { codigo:"91954", grupo:"Elétrica", descricao:"TOMADA 2P+T 220V 10A INDUSTRIAL — FORNEC. E INST.", un:"un", preco:55.00 },
  { codigo:"91955", grupo:"Elétrica", descricao:"TOMADA 3F+N+T 380V/32A — FORNEC. E INST.", un:"un", preco:185.00 },
  { codigo:"91956", grupo:"Elétrica", descricao:"QUADRO DE ILUMINAÇÃO E TOMADAS — FORNEC. E INST.", un:"un", preco:1200.00 },
  // ─── CONCRETO FUNDAÇÃO ────────────────────────────────────────────────────────
  { codigo:"96531", grupo:"Estrutura", descricao:"BLOCO DE FUNDAÇÃO EM CONCRETO ARMADO FCK=25MPA", un:"m³", preco:980.00 },
  { codigo:"96532", grupo:"Estrutura", descricao:"SAPATA ISOLADA EM CONCRETO ARMADO FCK=25MPA", un:"m³", preco:950.00 },
  { codigo:"96533", grupo:"Estrutura", descricao:"LAJE DE CONCRETO ARMADO FCK=25MPA E=15CM", un:"m²", preco:185.00 },
  { codigo:"96534", grupo:"Estrutura", descricao:"DRENO PROFUNDO / BRITA 3/4\" EM VALA", un:"m", preco:45.00 },

];

export const GRUPOS_SINAPI = [...new Set(SINAPI_BA.map(i => i.grupo))];
