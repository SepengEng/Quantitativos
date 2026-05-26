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

// Resolve preços: 1º por código, 2º por descrição (banco completo 12.638 itens)
async function resolverPrecosBatch(itens) {
  const resultado = {};
  const semPreco  = [];

  // 1ª passagem: batch por código
  const codigos = [...new Set(itens.map(i => i.sinapi_sugerido).filter(Boolean))];
  if (codigos.length) {
    try {
      const r = await fetch(`/api/sinapi?codigos=${encodeURIComponent(codigos.join(","))}`);
      const d = await r.json();
      if (d.mapa) Object.entries(d.mapa).forEach(([cod, item]) => { resultado[cod] = item.preco; });
    } catch {}
  }

  // 2ª passagem: itens sem preço → busca por descrição
  itens.forEach(it => {
    if (!resultado[it.sinapi_sugerido]) semPreco.push(it);
  });

  await Promise.all(semPreco.map(async it => {
    const desc = it.sinapi_descricao || it.descricao || "";
    if (!desc) return;
    try {
      const r = await fetch(`/api/sinapi?match=${encodeURIComponent(desc)}`);
      const d = await r.json();
      if (d.item?.preco) {
        resultado[it.sinapi_sugerido || desc] = d.item.preco;
        // atualiza o código para o real encontrado
        it._sinapi_real = { codigo: d.item.codigo, descricao: d.item.descricao, preco: d.item.preco };
      }
    } catch {}
  }));

  return resultado;
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
  "ST":"Estrutura",     // Steel Structure
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

// ─── PROMPTS POR DISCIPLINA ───────────────────────────────────────────────────
const BASE = `
INSTRUÇÕES DE ORÇAMENTISTA PROFISSIONAL:
1. Leia o cabeçalho/título do desenho para entender o que está representado e a escala (ex: 1:50, 1:100, 1:200)
2. Use TODAS as informações disponíveis: cotas explícitas, tabelas de armação, quadros de esquadrias, legendas, notas técnicas, hachuras e símbolos
3. Para tabelas de armação/materiais no desenho: extraia diretamente os dados (diâmetro, comprimento, quantidade de barras)
4. Quando não houver cota explícita: estime pela escala do desenho, prática construtiva típica ou contexto — e marque como Inferência
5. NUNCA retorne lista vazia se houver qualquer elemento quantificável visível — extraia o máximo possível
6. Para cada item, sugira o código SINAPI Bahia Não Desonerado mais preciso

Fonte de medição a usar em cada item:
"📐 Cota" = dimensão lida de cota explícita no desenho
"🔢 Contagem" = elementos contados símbolo a símbolo
"🧮 Cálculo" = calculado a partir de cotas (área = L×C, volume = área×esp, etc.)
"🔍 Inferência" = estimado por escala, tabela de armação ou prática construtiva

Retorne APENAS JSON válido sem texto antes ou depois:
{"disciplina":"...","escala":"1:XX","resumo":"descrição do que o desenho representa e principais dimensões encontradas","itens":[{"codigo_item":"XXX-001","descricao":"descrição técnica completa do serviço","un":"m|m²|m³|un|kg","qtd":0.00,"fonte":"📐 Cota","obs":"como foi medido especificamente","sinapi_sugerido":"XXXXX","sinapi_descricao":"descrição curta SINAPI"}],"alertas":["itens a confirmar em campo"]}`;

const PROMPTS = {
"Arquitetura":`Especialista em arquitetura predial. Extraia: PAREDES (m e m² por segmento — alvenaria e drywall separados), PISOS (m² por ambiente e tipo), ESQUADRIAS (tipo, dimensões, contagem), REVESTIMENTOS (m² por tipo), COBERTURA (m² e tipo), LOUÇAS (símbolo a símbolo), SPLITS (BTU anotados).
SINAPIs: Alv.9cm:87451|14cm:87452|Bl.concreto:89714|Drywall 48mm:90762|73mm:90763|Porcelanato 60x60:87893|Cerâmica parede:87264|Pintura:87880|Reboco:87529|Porta 0,80:88511|Janela correr:88520|Split 18000:88317|Bacia:86896|Lavatório:86897|Telha fibrocimento:88500|Impermeab.manta:88497
${BASE}`,
"Estrutura":`Especialista em estruturas concreto/metálica. Extraia: PILARES (seção e qtd), VIGAS (m e seção), LAJES (m² e espessura), CONCRETO (m³=área×esp), FORMAS (m²), ARMAÇÃO (kg=vol×taxa: laje 150/vigas 200/pilares 250 kg/m³), FUNDAÇÕES (tipo, dim, qtd).
SINAPIs: FCK20:96527|FCK25:96528|FCK30:96529|Forma:94965|CA-50:94966|CA-60:94967|Steel deck:96530|Estrut.metálica:98210|Estaca raiz:74004
${BASE}`,
"Elétrica":`Especialista em elétrica predial/industrial (NBR 5410). Extraia: ELETRODUTOS (m por ø e tipo), CABOS (m por seção mm²), TOMADAS/INTERRUPTORES (contar símbolos), LUMINÁRIAS (contar por tipo), QUADROS (QD/QDL — contar), DISJUNTORES (contar por amperagem), BANDEJAS (m por largura).
SINAPIs: Eletroduto PVC 25mm:91911|32mm:91912|50mm:91913|Metálico 1":91914|Bandeja 100x50:91935|200x50:91936|Cabo 2,5mm²:91925|4mm²:91926|6mm²:91927|10mm²:91928|16mm²:91929|Tomada 20A:91940|LED 40W:91945|Industrial 100W:91946|QD:91950|Disj.bip.20A:91951|Disj.trip.40A:91952
${BASE}`,
"Hidrossanitária":`Especialista em hidrossanitária (NBR 5626/8160). Extraia: ÁGUA FRIA (m por ø), ÁGUA QUENTE (m por ø), ESGOTO (m por ø — ramais/colunas), VENTILAÇÃO (m), REGISTROS/VÁLVULAS (qtd por tipo), RALOS/CAIXAS (contar símbolos), LOUÇAS/METAIS (símbolo a símbolo).
SINAPIs: Água PVC 25mm:89837|32mm:89838|50mm:89839|75mm:89840|100mm:89841|Esgoto 50mm:89850|75mm:89851|100mm:89852|150mm:89855|Ralo sifonado:89870|Cx sifonada:89871|Cx inspeção:89858|Registro gaveta:89842|Bacia:86896|Lavatório:86897
${BASE}`,
"Pluvial":`Especialista em drenagem pluvial (NBR 10844). Extraia: TUBULAÇÕES (m por ø — registrar i=), PRUMADAS/TQ (contar símbolo a símbolo), RALOS (contar cada), CALHAS (m por largura), CAIXAS INSPEÇÃO (contar por tamanho), CONEXÕES (joelhos/tês pelas direções), BLOCOS ANCORAGEM (1/prumada).
SINAPIs: PVC SR 75mm:89852|100mm:89853|150mm:89854|Joelho 90°:89855|Tê:89856|Ralo 100mm:89857|Cx inspeção 60x60:89858|Calha galv.:88504|Bloco ancoragem:74010
${BASE}`,
"Incêndio":`Especialista em incêndio (NBR 13714/13752/17240). Extraia: SPRINKLERS (contar por tipo: pendant/upright/sidewall), TUB.SPRINKLER (m por ø em aço galv.), HIDRANTES (contar por tipo 1/2/3), TUB.HIDRANTE (m por ø), DETECTORES (contar: fumaça/calor/chama), ACIONADORES MANUAIS (contar), CENTRAL ALARME (contar), ILUM.EMERGÊNCIA (contar), SINALIZAÇÃO (contar placas), EXTINTORES (contar por tipo).
SINAPIs: Sprinkler pendant:74300|upright:74301|Aço galv.1":74156|1.1/2":74158|2":74159|2.1/2":74160|Hidrante tipo 2:74310|Mangueira 15m:74311|Detector fumaça:74320|Central alarme:74323|Ilum.emergência:91947|Placa sinalização:74330|Extintor CO2:74340|Extintor pó:74341
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
"SPDA":`Especialista em SPDA (NBR 5419). Extraia: CAPTORES (tipo e qtd: Franklin/gaiola/ESE), CABOS DESCENDENTES (m), ANEL ATERRAMENTO (m), HASTES (contar), CAIXAS INSPEÇÃO SPDA (contar), DPS (contar por classe I/II/III), CABO MALHA (m cobertura).
SINAPIs: Haste aterramento:91960|Cabo cobre nu 35mm²:91967|50mm²:91961|70mm²:91968|Cx inspeção SPDA:91962|Captor Franklin:91963|DPS classe II:91965
${BASE}`,
"Especificação":`Especialista em especificações técnicas de materiais e equipamentos industriais. 
Analise o documento e extraia: EQUIPAMENTOS (nome, tag, capacidade/volume, potência), TUBULAÇÕES (material, diâmetro, comprimento estimado), TANQUES/VASOS (volume m³, material, dimensões), BOMBAS (tipo, vazão m³/h, potência kW), INSTRUMENTAÇÃO (manômetros, transmissores, válvulas - contar por símbolo). 
Para itens de processo sem SINAPI, use código da família mais próxima ou deixe sinapi_sugerido vazio.
SINAPIs: Tubo aço carbono 1":74156|2":74157|4":74159|6":74160|Válvula esfera:74163|Suporte:74165|Bomba centrífuga fornec.:98300
${BASE}`,
"Gás Industrial":`Especialista em gás industrial/processo (NBR 15526). Extraia: TUBULAÇÕES (m por ø e material: aço carbono/cobre/PEAD), VÁLVULAS (contar por tipo e ø), SUPORTES (a cada 1,5m para ø≤2"), INSTRUMENTAÇÃO (contar manômetros/transmissores), EQUIPAMENTOS (reguladores/filtros — contar), ISOLAMENTO (m com isolamento).
SINAPIs: Aço carbono 1":74156|2":74157|3":74158|4":74159|6":74160|Cobre 15mm:74161|28mm:74162|Válvula esfera inox 1":74163|2":74164|Suporte sela:74165|Isolamento:74166|Regulador pressão:74203
${BASE}`,
};

function getPrompt(d) {
  return PROMPTS[d] || `Especialista em engenharia civil brasileira. Extraia todos os quantitativos pelas cotas e símbolos visíveis. Sugira código SINAPI Bahia para cada item. ${BASE}`;
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
  const [form,setForm]               = useState({nome:"",clienteId:"",descricao:""});

  const criar=()=>{
    if(!form.nome.trim())return;
    const nova={id:uid(),...form,criadoEm:new Date().toLocaleDateString("pt-BR"),plantas:[]};
    setObras(p=>[...p,nova]);setForm({nome:"",clienteId:"",descricao:""});setShowForm(false);setObraAtiva(nova.id);
  };

  const obra   = obras.find(o=>o.id===obraAtiva);
  const planta = obra?.plantas?.find(p=>p.id===plantaAtiva);

  if(obra&&planta) return <VisualizadorPlanta planta={planta} obra={obra} onBack={()=>setPlantaAtiva(null)} obras={obras} setObras={setObras}/>;
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
          <div style={{marginBottom:12}}><label style={S.label}>Descrição</label><input style={S.input} value={form.descricao} onChange={e=>setForm(p=>({...p,descricao:e.target.value}))} placeholder="Localização, contrato..."/></div>
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
  const fileRef = useRef();
  const ultimaRequisicao = useRef(0); // timestamp do último fetch à API (throttle global)
  const cliente = clientes.find(c=>c.id===obra.clienteId);
  const atualizar = (fn)=>setObras(p=>p.map(o=>o.id===obra.id?fn(o):o));
  const obraAtual = obras.find(o=>o.id===obra.id);

  const pdfParaImagens = (file)=>new Promise((resolve,reject)=>{
    const go=()=>{
      const lib=window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const url=URL.createObjectURL(file);
      lib.getDocument(url).promise.then(async pdf=>{
        const imgs=[];
        for(let i=1;i<=pdf.numPages;i++){
          const page=await pdf.getPage(i);
          const vp=page.getViewport({scale:2.2});
          const canvas=document.createElement("canvas");
          canvas.width=vp.width;canvas.height=vp.height;
          await page.render({canvasContext:canvas.getContext("2d"),viewport:vp}).promise;
          imgs.push({base64:canvas.toDataURL("image/jpeg",0.92).split(",")[1],type:"image/jpeg"});
        }
        URL.revokeObjectURL(url);resolve(imgs);
      }).catch(reject);
    };
    if(window.pdfjsLib)return go();
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload=go;s.onerror=reject;document.head.appendChild(s);
  });

  // Carregar arquivos (sem analisar ainda)
  const carregarArquivos = async(files)=>{
    setErro("");
    const novos=[];
    for(const file of Array.from(files)){
      const disc=detectarDisciplina(file.name);
      const id=uid();
      setPendentes(p=>[...p,{id,fileName:file.name,disciplina:disc,imgs:null,status:"carregando",progresso:"Lendo arquivo..."}]);
      try{
        let imgs=[];
        let progDesc="";
        if(file.type==="application/pdf"){
          // Envia PDF diretamente ao Gemini (suporte nativo — preserva qualidade de CAD/DWG)
          const base64=await toB64(file);
          imgs=[{base64,type:"application/pdf"}];
          progDesc="PDF completo";
        } else if(file.type.startsWith("image/")){
          imgs=[{base64:await toB64(file),type:file.type}];
          progDesc=`${imgs.length} pág.`;
        } else { setPendentes(p=>p.filter(x=>x.id!==id)); continue; }
        setPendentes(p=>p.map(x=>x.id===id?{...x,imgs,status:"pronto",progresso:`${progDesc} · ${disc||"disciplina a detectar"}`}:x));
        novos.push(id);
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
        const prompt=getPrompt(pend.disciplina);
        const todosItens=[];let ultimoParsed=null;
        const isPDF=pend.imgs.length===1&&pend.imgs[0].type==="application/pdf";
        for(let i=0;i<pend.imgs.length;i++){
          // Delay de 4s entre páginas para respeitar limite free do Gemini (20 req/min)
          if(i>0) await new Promise(r=>setTimeout(r,4000));
          const pgMsg=isPDF?`IA lendo PDF completo${pend.disciplina?` · ${pend.disciplina}`:""}...`:`IA analisando pág. ${i+1}/${pend.imgs.length}${pend.disciplina?` · ${pend.disciplina}`:""}...`;
          setPendentes(p=>p.map(x=>x.id===pend.id?{...x,progresso:pgMsg}:x));
          const reqBody=JSON.stringify({model:"claude-sonnet-4-6",max_tokens:isPDF?8192:4096,system:prompt,
            messages:[{role:"user",content:[
              {type:"image",source:{type:"base64",media_type:pend.imgs[i].type,data:pend.imgs[i].base64}},
              {type:"text",text:isPDF
                ?`Analise TODAS as páginas/pranchas deste PDF de engenharia${pend.disciplina?` de ${pend.disciplina}`:""}: ${pend.fileName}. Extraia todos os quantitativos de TODAS as pranchas e retorne um único JSON consolidado.`
                :`Analise esta planta${pend.disciplina?` de ${pend.disciplina}`:""}: ${pend.fileName}${pend.imgs.length>1?` (pág.${i+1}/${pend.imgs.length})`:""}`}
            ]}]
          });
          // Throttle: garante intervalo mínimo de 3.5s entre requisições (≤17 RPM global)
          const agora=Date.now();
          const espThrottle=3500-(agora-ultimaRequisicao.current);
          if(espThrottle>0) await new Promise(r=>setTimeout(r,espThrottle));
          ultimaRequisicao.current=Date.now();
          const chamar=()=>{ultimaRequisicao.current=Date.now();return fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:reqBody});};
          let data=await (await chamar()).json();
          // Rate limit — retenta até 8x esperando o tempo sugerido
          for(let rt=0;rt<8&&data.error?.type==="rate_limit";rt++){
            const espera=(data.error.retryAfter||30)*1000;
            setPendentes(p=>p.map(x=>x.id===pend.id?{...x,progresso:`⏳ Aguardando ${Math.round(espera/1000)}s (tentativa ${rt+1}/8)...`}:x));
            await new Promise(r=>setTimeout(r,espera));
            data=await (await chamar()).json();
          }
          if(data.error){
            throw new Error(`Gemini API: ${data.error.message||data.error.type||JSON.stringify(data.error)}`);
          }
          if(!data.content){
            throw new Error(`Resposta inesperada da API: ${JSON.stringify(data).slice(0,200)}`);
          }
          const text=data.content?.find(b=>b.type==="text")?.text||"{}";
          console.log(`[IA pág.${i+1}] resposta bruta:`, text.slice(0,300));
          let parsed={itens:[]};
          try{
            const clean=text.replace(/```json[\s\S]*?```|```[\s\S]*?```/g, m=>m.replace(/```json|```/g,"")).replace(/```json|```/g,"").trim();
            const jsonMatch=clean.match(/\{[\s\S]*\}/);
            if(jsonMatch) parsed=JSON.parse(jsonMatch[0]);
          }catch(parseErr){
            console.warn("Falha ao parsear JSON da IA:", parseErr.message, "Texto:", text.slice(0,500));
          }
          todosItens.push(...(parsed.itens||[]));
          ultimoParsed=parsed;
        }
        // Buscar preços SINAPI — API completa (12.638 itens SINAPI BA)
        setPendentes(p=>p.map(x=>x.id===pend.id?{...x,progresso:"Buscando preços SINAPI..."}:x));
        const precoMap = await resolverPrecosBatch(todosItens);
        const itensEnriquecidos=todosItens.map(it=>({
          ...it,
          // Se encontrou match por descrição, usa os dados reais
          sinapi_sugerido: it._sinapi_real?.codigo || it.sinapi_sugerido,
          sinapi_descricao: it._sinapi_real?.descricao || it.sinapi_descricao,
          preco_sinapi: it._sinapi_real?.preco || precoMap[it.sinapi_sugerido] || null
        }));
        const nPrecos = itensEnriquecidos.filter(i=>i.preco_sinapi).length;
        console.log(`SINAPI: ${nPrecos}/${itensEnriquecidos.length} itens com preço`);
        const novaPlanta={
          id:uid(),fileName:pend.fileName,
          disciplina:ultimoParsed?.disciplina||pend.disciplina,
          escala:ultimoParsed?.escala,resumo:ultimoParsed?.resumo,
          alertas:ultimoParsed?.alertas||[],itens:itensEnriquecidos,
          analisadoEm:new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}),
        };
        atualizar(o=>({...o,plantas:[...(o.plantas||[]),novaPlanta]}));
        const totalValor=itensEnriquecidos.reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0);
        const progMsg=itensEnriquecidos.length===0
          ?`⚠️ 0 itens — IA respondeu: "${(ultimoParsed?.resumo||ultimoParsed?.disciplina||"sem resumo").slice(0,100)}"`
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
          {totalOrcado>0&&<div style={{fontSize:14,fontWeight:700,color:"#059669"}}>{fmtR(totalOrcado)} <span style={{fontSize:12,fontWeight:400,color:"#6b7280"}}>sem BDI</span></div>}
        </div>
        {obra.descricao&&<p style={{fontSize:13,color:"#6b7280",margin:"4px 0 0"}}>{obra.descricao}</p>}
      </div>

      {/* Dica de nomenclatura */}
      <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:12,color:"#166534"}}>
        💡 Nomeie os arquivos com o prefixo da disciplina:
        <strong> ARQ- ELE- HID- PLU- INC- HVA- CFT- VOZ- SPD- GAS- EST-</strong>
      </div>

      {/* Zona de drop */}
      <div onDrop={e=>{e.preventDefault();setDragOver(false);carregarArquivos(e.dataTransfer.files);}}
        onDragOver={e=>{e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onClick={()=>fileRef.current?.click()}
        style={{border:`2px dashed ${dragOver?"#2563eb":"#d1d5db"}`,borderRadius:12,padding:"24px 20px",textAlign:"center",cursor:"pointer",background:dragOver?"#eff6ff":"#fafafa",marginBottom:16,transition:"all .15s"}}>
        <div style={{fontSize:28,marginBottom:6}}>📁</div>
        <div style={{fontSize:14,fontWeight:600,marginBottom:3}}>Arraste as plantas aqui</div>
        <div style={{fontSize:12,color:"#9ca3af"}}>PDF do CAD (ARQ, ELE, HID, PLU, INC, HVAC...) — carregue todas e clique em Orçar</div>
        <input ref={fileRef} type="file" multiple accept=".pdf,image/*" style={{display:"none"}} onChange={e=>carregarArquivos(e.target.files)}/>
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

// ─── VISUALIZADOR ─────────────────────────────────────────────────────────────
function VisualizadorPlanta({planta,obra,onBack}) {
  const [filtro,setFiltro] = useState("Todos");
  const [bdi,setBdi]       = useState(25);
  const itens       = planta.itens||[];
  const filtrados   = filtro==="Todos"?itens:itens.filter(i=>i.fonte===filtro);
  const comPreco    = itens.filter(i=>i.preco_sinapi);
  const totalSemBdi = comPreco.reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0);
  const totalComBdi = totalSemBdi*(1+bdi/100);
  const cobertura   = itens.length?Math.round((comPreco.length/itens.length)*100):0;
  const col         = DISC_COR[planta.disciplina]||{};

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
        <button onClick={exportar} style={S.btn}>↓ CSV</button>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:12}}>
        {[{label:"Itens",valor:itens.length,cor:"#111"},{label:"SINAPI cobertos",valor:`${cobertura}%`,cor:cobertura>=70?"#059669":"#f59e0b"},{label:"Total sem BDI",valor:fmtR(totalSemBdi),cor:"#059669"},{label:`Com BDI ${bdi}%`,valor:fmtR(totalComBdi),cor:"#059669"}].map(c=>(
          <div key={c.label} style={{background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:10,padding:"11px 14px"}}>
            <div style={{fontSize:11,color:"#6b7280",marginBottom:3}}>{c.label}</div>
            <div style={{fontSize:17,fontWeight:700,color:c.cor}}>{c.valor}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"#6b7280"}}>BDI:</span>
        <input type="range" min={0} max={50} value={bdi} onChange={e=>setBdi(Number(e.target.value))} style={{width:100}}/>
        <input type="number" value={bdi} onChange={e=>setBdi(Number(e.target.value))} min={0} max={100} style={{width:52,padding:"4px 8px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,textAlign:"center"}}/>%
        <div style={{width:1,height:18,background:"#e5e7eb",margin:"0 4px"}}/>
        {Object.entries(FONTE_COR).map(([k,v])=>(
          <span key={k} onClick={()=>setFiltro(filtro===k?"Todos":k)} style={{fontSize:11,padding:"2px 9px",borderRadius:20,background:v.bg,color:v.color,cursor:"pointer",border:filtro===k?`2px solid ${v.color}`:"1px solid transparent",fontWeight:filtro===k?600:400}}>{k}</span>
        ))}
        {filtro!=="Todos"&&<button onClick={()=>setFiltro("Todos")} style={{...S.btn,fontSize:11,padding:"2px 9px"}}>✕</button>}
        <span style={{fontSize:11,color:"#9ca3af",marginLeft:"auto"}}>{filtrados.length} itens</span>
      </div>

      <div style={{...S.card,overflow:"hidden",marginBottom:14}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr>{["Cód.","Descrição","Un.","Qtd.","Fonte","SINAPI","Desc. SINAPI","Preço Unit.","Subtotal",`c/BDI ${bdi}%`,"Obs."].map((h,i)=>(
              <th key={h} style={{...S.th,textAlign:[3,7,8,9].includes(i)?"right":"left"}}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {filtrados.map((it,j)=>{
                const sub=it.preco_sinapi?it.preco_sinapi*(it.qtd||0):null;
                const fb=FONTE_COR[it.fonte]||{bg:"#f3f4f6",color:"#6b7280"};
                return (
                  <tr key={j} style={{background:j%2===0?"#fff":"#fafafa",borderBottom:"1px solid #f3f4f6"}}>
                    <td style={{...S.td,fontFamily:"monospace",fontSize:10,color:"#9ca3af",whiteSpace:"nowrap"}}>{it.codigo_item}</td>
                    <td style={{...S.td,lineHeight:1.4,minWidth:200}}>{it.descricao}</td>
                    <td style={{...S.td,textAlign:"center",color:"#6b7280"}}>{it.un}</td>
                    <td style={{...S.td,textAlign:"right",fontWeight:600}}>{fmt(it.qtd)}</td>
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
  const [obraId,setObraId]     = useState("");
  const [plantaId,setPlantaId] = useState("");
  const [bdi,setBdi]           = useState(25);

  const obra   = obras.find(o=>o.id===obraId);
  const planta = obra?.plantas?.find(p=>p.id===plantaId);
  const itens  = planta?.itens||[];
  const comPreco    = itens.filter(i=>i.preco_sinapi);
  const totalSemBdi = comPreco.reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0);
  const totalComBdi = totalSemBdi*(1+bdi/100);

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
          <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,fontWeight:600}}>{obra.nome} — Resumo por disciplina</span>
            <span style={{fontSize:14,fontWeight:700,color:"#059669"}}>{fmtR(totalObra*(1+bdi/100))} <span style={{fontSize:11,fontWeight:400,color:"#6b7280"}}>c/ BDI {bdi}%</span></span>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr>{["Disciplina","Plantas","Itens","Total sem BDI",`Total c/BDI ${bdi}%`].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
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
                  </tr>
                );
              })}
              <tr style={{background:"#f0fdf4",borderTop:"2px solid #e5e7eb"}}>
                <td style={{...S.td,fontWeight:700}}>TOTAL OBRA</td>
                <td style={{...S.td,textAlign:"center",fontWeight:600}}>{(obra.plantas||[]).length}</td>
                <td style={{...S.td,textAlign:"center",fontWeight:600}}>{Object.values(resumoObra).reduce((s,v)=>s+v.itens,0)}</td>
                <td style={{...S.td,textAlign:"right",fontWeight:700,color:"#059669",fontSize:13}}>{fmtR(totalObra)}</td>
                <td style={{...S.td,textAlign:"right",fontWeight:800,color:"#047857",fontSize:15}}>{fmtR(totalObra*(1+bdi/100))}</td>
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
            <button onClick={exportar} style={S.btnPrimary}>↓ Exportar CSV</button>
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
