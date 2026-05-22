"use client";
import { useState, useRef, useCallback, useEffect } from "react";

// ─── DETECÇÃO DE DISCIPLINA PELO NOME DO ARQUIVO ─────────────────────────────
const PREFIXOS = {
  "ARQ": "Arquitetura",   "EST": "Estrutura",
  "ELE": "Elétrica",      "HID": "Hidrossanitária",
  "PLU": "Pluvial",       "DRE": "Pluvial",
  "INC": "Incêndio",      "SPK": "Incêndio",
  "HVA": "HVAC",          "ACL": "HVAC",
  "CFT": "CFTV",          "CAM": "CFTV",
  "VOZ": "Dados e Voz",   "DAD": "Dados e Voz",
  "SPD": "SPDA",          "GAS": "Gás Industrial",
  "TUB": "Gás Industrial","MEC": "Mecânica",
};

function detectarDisciplina(fileName) {
  if (!fileName) return null;
  const u = fileName.toUpperCase();
  for (const [p, d] of Object.entries(PREFIXOS)) {
    if (u.startsWith(p) || u.includes(`-${p}-`) || u.includes(`_${p}_`) || u.includes(`-${p}_`) || u.includes(`_${p}-`)) return d;
  }
  return null;
}

// ─── PROMPTS POR DISCIPLINA ───────────────────────────────────────────────────
const BASE = `
REGRAS: Meça pelas cotas visíveis e conte símbolos. NÃO copie tabelas do documento.
Sugira código SINAPI Bahia Não Desonerado para cada item.
Fonte: "📐 Cota" | "🔢 Contagem" | "🧮 Cálculo" | "🔍 Inferência"

Retorne APENAS JSON:
{"disciplina":"...","escala":"1:XX","resumo":"...","itens":[{"codigo_item":"XXX-001","descricao":"...","un":"m|m²|m³|un|kg","qtd":0.00,"fonte":"📐 Cota","obs":"como medido","sinapi_sugerido":"XXXXX","sinapi_descricao":"..."}],"alertas":["..."]}`;

const PROMPTS = {
"Arquitetura":`Especialista em arquitetura predial brasileira. Extraia:
PAREDES: comprimento (m) e área (m²) por segmento — alvenaria e drywall separados. Some cada cota individualmente.
PISOS: área (m²) por ambiente e tipo de acabamento
ESQUADRIAS: tipo (PM1/P01/J01...), dimensões pelas cotas, contagem dos arcos/símbolos
REVESTIMENTOS: área de parede por tipo (cerâmica, pintura, reboco)
COBERTURA: área (m²) e tipo
LOUÇAS: contar símbolo a símbolo (bacia, lavatório, cuba)
SPLITS: contar anotações de BTU na planta
SINAPIs: Alvenaria 9cm:87451 | 14cm:87452 | Bloco concreto:89714 | Drywall 48mm:90762 | Drywall 73mm:90763
Porcelanato 60x60:87893 | Cerâmica parede:87264 | Pintura látex:87880 | Reboco:87529
Porta madeira 0,80:88511 | Janela correr 2,00x1,20:88520 | Split 18000:88317
Bacia:86896 | Lavatório:86897 | Telha fibrocimento:88500 | Impermeabilização manta:88497
${BASE}`,

"Estrutura":`Especialista em estruturas de concreto armado e metálicas. Extraia:
PILARES: seção (cmxcm) e quantidade — contar por tipo
VIGAS: comprimento por vão (m) e seção
LAJES: área (m²) por tipo e espessura lida nas cotas
CONCRETO: volume (m³) = área × espessura
FORMAS: área (m²) = área estrutural × fator
ARMAÇÃO: peso (kg) = volume × taxa (laje:150kg/m³, vigas:200, pilares:250)
FUNDAÇÕES: tipo, dimensões, quantidade
SINAPIs: FCK20:96527 | FCK25:96528 | FCK30:96529 | Forma madeira:94965
Armação CA-50:94966 | CA-60:94967 | Steel deck:96530
Estrutura metálica:98210 | Coluna perfil I:98211 | Estaca raiz:74004
${BASE}`,

"Elétrica":`Especialista em instalações elétricas prediais e industriais (NBR 5410). Extraia:
ELETRODUTOS: comprimento (m) por diâmetro e tipo (PVC, metálico)
CABOS: comprimento (m) por seção mm² — leia circuitos no diagrama
TOMADAS/INTERRUPTORES: contar cada símbolo por tipo
LUMINÁRIAS: contar por tipo (LED embutir, industrial, emergência)
QUADROS: QD/QDL/QF — contar e identificar pelo diagrama unifilar
DISJUNTORES: contar por amperagem
BANDEJAS/ELETROCALHAS: comprimento (m) por largura
ATERRAMENTO: hastes e cabos
SINAPIs: Eletroduto PVC 25mm:91911 | 32mm:91912 | 50mm:91913 | Metálico 1":91914
Bandeja 100x50:91935 | Bandeja 200x50:91936
Cabo 2,5mm²:91925 | 4mm²:91926 | 6mm²:91927 | 10mm²:91928 | 16mm²:91929
Tomada 20A:91940 | Luminária LED 40W:91945 | Luminária industrial:91946
QD distribuição:91950 | Disjuntor bipolar 20A:91951 | Disjuntor tripolar 40A:91952
${BASE}`,

"Hidrossanitária":`Especialista em hidrossanitária (NBR 5626/8160). Extraia:
ÁGUA FRIA: comprimento (m) por diâmetro (15,20,25,32,50,75,100mm) — cor azul
ÁGUA QUENTE: comprimento (m) por diâmetro — cor vermelha
ESGOTO: comprimento (m) por diâmetro — separar ramais/colunas/coletores
VENTILAÇÃO: tubos de ventilação (m) por diâmetro
REGISTROS/VÁLVULAS: contar por tipo e diâmetro
RALOS/CAIXAS: contar cada símbolo (ralo sifonado, cx sifonada, cx inspeção)
LOUÇAS/METAIS: bacia, lavatório, chuveiro, torneira — contar símbolo a símbolo
SINAPIs: Tubo PVC água 25mm:89837 | 32mm:89838 | 50mm:89839 | 75mm:89840 | 100mm:89841
Tubo PVC esgoto 50mm:89850 | 75mm:89851 | 100mm:89852 | 150mm:89855
Ralo sifonado:89870 | Cx sifonada:89871 | Cx inspeção:89858
Registro gaveta 25mm:89842 | Bacia:86896 | Lavatório:86897
${BASE}`,

"Pluvial":`Especialista em drenagem pluvial (NBR 10844). Extraia:
TUBULAÇÕES: comprimento (m) por diâmetro — registrar inclinação i= indicada
PRUMADAS/TUBOS QUEDA: contar símbolo a símbolo (PLD/TQ) com diâmetro
RALOS: contar cada ralo na laje/cobertura
CALHAS: comprimento (m) por largura
CAIXAS DE INSPEÇÃO: contar por tamanho (30x30, 60x60, 80x80)
CONEXÕES: joelhos e tês pelas mudanças de direção visíveis
BLOCOS DE ANCORAGEM: 1 por prumada
SINAPIs: Tubo PVC SR 75mm:89852 | 100mm:89853 | 150mm:89854
Joelho 90° 100mm:89855 | Tê 100mm:89856 | Ralo 100mm:89857 | Cx inspeção 60x60:89858
Calha galvanizada:88504 | Bloco ancoragem:74010
${BASE}`,

"Incêndio":`Especialista em prevenção e combate a incêndio (NBR 13714/13752/17240). Extraia:
SPRINKLERS: contar cabeça a cabeça por tipo (pendant/upright/sidewall)
TUBULAÇÕES SPRINKLER: comprimento (m) por diâmetro (aço galv./CPVC)
HIDRANTES: contar abrigos por tipo (1/2/3)
TUBULAÇÕES HIDRANTE: comprimento (m) por diâmetro (65/80mm)
DETECTORES: contar por tipo (fumaça, calor, chama)
ACIONADORES MANUAIS: contar botoeiras
CENTRAL DE ALARME: contar centrais e repetidoras
ILUMINAÇÃO EMERGÊNCIA: contar blocos autônomos
SINALIZAÇÃO: contar placas fotoluminescentes
EXTINTORES: contar pontos por tipo (CO2, Pó, Água)
SINAPIs: Sprinkler pendant:74300 | upright:74301 | Tubo aço galv 1":74156 | 2":74159
Hidrante tipo 2:74310 | Mangueira 15m:74311 | Detector fumaça:74320
Central alarme:74323 | Ilum. emergência:91947 | Placa sinalização:74330
Extintor CO2 6kg:74340 | Extintor pó 6kg:74341
${BASE}`,

"HVAC":`Especialista em climatização e ventilação (NBR 16401). Extraia:
SPLITS/FAN-COILS: contar por capacidade BTU/h — ler anotação no símbolo
DUTOS: área chapa (m²) = comprimento × perímetro seção — separar insuflamento/retorno
DUTOS FLEXÍVEIS: comprimento linear (m)
DIFUSORES/GRELHAS: contar por tipo (insuflamento/retorno/exaustão)
EQUIPAMENTOS: UTA, VRF, chiller, torre — contar e registrar capacidade
TUBULAÇÕES ÁGUA GELADA: comprimento (m) por diâmetro
ISOLAMENTO DUTOS: m² com isolamento indicado
SINAPIs: Split 9000:88315 | 12000:88316 | 18000:88317 | 24000:88318 | Cassete 36000:88319
Duto chapa galv.:88320 | Duto flexível:88322 | Difusor 300x300:88321 | Grelha retorno:88323
Chiller 30TR:88330 | Fan-coil:88331 | Isolamento duto:88335
${BASE}`,

"CFTV":`Especialista em CFTV e segurança eletrônica. Extraia:
CÂMERAS: contar por tipo (dome IP, bullet, PTZ, 360°) — ler símbolo/legenda
CABOS: comprimento (m) por tipo (UTP Cat6, coaxial RG59, fibra)
ELETRODUTOS: comprimento (m) por diâmetro
DVR/NVR: contar por canais indicados
CATRACAS/TORNIQUETES: contar
LEITORES DE ACESSO: contar por tipo
RACKS/GABINETES: contar e dimensão
NOBREAKS: contar por potência
SINAPIs: Câmera dome IP:91960 | Câmera bullet:91961 | Câmera PTZ:91962
Cabo UTP Cat6:91970 | Cabo coaxial:91971 | Eletroduto 25mm:91911 | 32mm:91912
NVR 16ch:91975 | Rack 12U:91980 | Patch panel Cat6:91981
${BASE}`,

"Dados e Voz":`Especialista em cabeamento estruturado (NBR 14565). Extraia:
PONTOS DE REDE: contar tomadas RJ45 por ambiente
CABOS UTP: comprimento (m) por categoria (Cat5e, Cat6, Cat6A)
ELETRODUTOS: comprimento (m) por diâmetro
BANDEJAS: comprimento (m) por tamanho
PATCH PANELS: contar por portas (24/48p)
SWITCHES: contar por portas
RACKS: contar por tamanho (12U/24U/42U)
FIBRA ÓPTICA: comprimento (m) backbone
SINAPIs: Cabo Cat6:91970 | Cat6A:91973 | Fibra óptica:91972
Eletroduto 25mm:91911 | Bandeja 100x50:91935 | Patch panel 24p:91981
Switch 24p:91982 | Rack 24U:91983 | Tomada RJ45:91984
${BASE}`,

"SPDA":`Especialista em proteção contra descargas atmosféricas (NBR 5419). Extraia:
CAPTORES: tipo e quantidade (Franklin, gaiola Faraday, ESE)
CABOS DESCENDENTES: comprimento (m) do cabo de descida
ANEL DE ATERRAMENTO: comprimento (m) do barramento perimetral
HASTES: contar hastes de aterramento
CAIXAS INSPEÇÃO SPDA: contar
DPS: contar por classe (I/II/III)
CABO MALHA: comprimento (m) na cobertura
SINAPIs: Haste aterramento 5/8":91960 | Cabo cobre nu 35mm²:91967 | 50mm²:91961 | 70mm²:91968
Cx inspeção SPDA:91962 | Captor Franklin:91963 | DPS classe II:91965
${BASE}`,

"Gás Industrial":`Especialista em gás industrial e de processo (NBR 15526 / normas BYD). Extraia:
TUBULAÇÕES: comprimento (m) por diâmetro e material (aço carbono, cobre, PEAD, inox)
VÁLVULAS: contar por tipo (esfera, gaveta, borboleta, retenção) e diâmetro
SUPORTES: estimar a cada 1,5m para aço ≤2" — contar mudanças de direção
INSTRUMENTAÇÃO: manômetros, transmissores, fluxômetros — contar por símbolo
EQUIPAMENTOS: reguladores, filtros, separadores — contar
ISOLAMENTO: metros de tubo com isolamento indicado
SINAPIs: Tubo aço carbono 1":74156 | 2":74157 | 3":74158 | 4":74159 | 6":74160
Tubo cobre 15mm:74161 | 28mm:74162 | Válvula esfera inox 1":74163 | 2":74164
Suporte sela até 2":74165 | Isolamento lã rocha:74166 | Regulador pressão:74203
${BASE}`,
};

function getPrompt(disciplina) {
  return PROMPTS[disciplina] || `Especialista em engenharia civil brasileira. Extraia todos os quantitativos do desenho pelas cotas e símbolos visíveis. Sugira código SINAPI Bahia para cada item. ${BASE}`;
}

// ─── CORES DAS DISCIPLINAS ────────────────────────────────────────────────────
const DISC_COR = {
  "Arquitetura":     { bg:"#dbeafe", text:"#1e40af", border:"#93c5fd" },
  "Estrutura":       { bg:"#ede9fe", text:"#5b21b6", border:"#c4b5fd" },
  "Elétrica":        { bg:"#fef3c7", text:"#92400e", border:"#fcd34d" },
  "Hidrossanitária": { bg:"#dcfce7", text:"#166534", border:"#86efac" },
  "Pluvial":         { bg:"#d1fae5", text:"#065f46", border:"#6ee7b7" },
  "Incêndio":        { bg:"#fee2e2", text:"#991b1b", border:"#fca5a5" },
  "HVAC":            { bg:"#e0f2fe", text:"#0c4a6e", border:"#7dd3fc" },
  "CFTV":            { bg:"#f3e8ff", text:"#6b21a8", border:"#d8b4fe" },
  "Dados e Voz":     { bg:"#fce7f3", text:"#9d174d", border:"#f9a8d4" },
  "SPDA":            { bg:"#fff7ed", text:"#9a3412", border:"#fdba74" },
  "Gás Industrial":  { bg:"#f0fdf4", text:"#14532d", border:"#86efac" },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2, 9);
const fmt  = (n) => typeof n === "number" ? n.toLocaleString("pt-BR", { maximumFractionDigits:2 }) : (n || "—");
const fmtR = (n) => n?.toLocaleString("pt-BR", { style:"currency", currency:"BRL" }) || "—";
const toBase64 = (f) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(f);
});
const FONTE_COR = {
  "📐 Cota":       { bg:"#dbeafe", color:"#1e40af" },
  "🔢 Contagem":   { bg:"#dcfce7", color:"#166534" },
  "🧮 Cálculo":    { bg:"#ede9fe", color:"#5b21b6" },
  "🔍 Inferência": { bg:"#fef3c7", color:"#92400e" },
};
const S = {
  card:       { background:"#fff", border:"1px solid #e5e7eb", borderRadius:12 },
  input:      { width:"100%", padding:"8px 12px", border:"1px solid #d1d5db", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" },
  btn:        { padding:"8px 16px", border:"1px solid #d1d5db", borderRadius:8, background:"#fff", cursor:"pointer", fontSize:13, fontWeight:500 },
  btnPrimary: { padding:"8px 16px", border:"none", borderRadius:8, background:"#111", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:500 },
  th:         { padding:"8px 10px", textAlign:"left", fontWeight:600, color:"#6b7280", fontSize:11, borderBottom:"1px solid #e5e7eb", background:"#f9fafb", whiteSpace:"nowrap" },
  td:         { padding:"8px 10px", fontSize:12, borderBottom:"1px solid #f3f4f6", verticalAlign:"top" },
  label:      { fontSize:12, fontWeight:500, color:"#374151", display:"block", marginBottom:4 },
};

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function QuantitativoApp() {
  const [secao, setSecao]     = useState("obras");
  const [clientes, setClientes] = useState(() => { try { return JSON.parse(localStorage.getItem("qt_clientes")||"[]"); } catch { return []; } });
  const [obras, setObras]     = useState(() => { try { return JSON.parse(localStorage.getItem("qt_obras")||"[]"); } catch { return []; } });
  const [sinapiRef, setSinapiRef] = useState(null);

  useEffect(() => { localStorage.setItem("qt_clientes", JSON.stringify(clientes)); }, [clientes]);
  useEffect(() => { localStorage.setItem("qt_obras",    JSON.stringify(obras));    }, [obras]);
  useEffect(() => {
    fetch("/api/sinapi?q=").then(r=>r.json()).then(d=>{ if(d.referencia) setSinapiRef(d.referencia); }).catch(()=>{});
  }, []);

  const totalPlanta = obras.reduce((s,o) => s+(o.plantas?.length||0), 0);
  const totalItens  = obras.reduce((s,o) => s+(o.plantas||[]).reduce((ss,p) => ss+(p.itens?.length||0), ss), 0);

  const nav = [
    { id:"obras",     label:"Obras",        icon:"🏗️" },
    { id:"clientes",  label:"Clientes",     icon:"🏢" },
    { id:"sinapi",    label:"SINAPI Bahia", icon:"📋" },
    { id:"orcamento", label:"Orçamento",    icon:"💰" },
  ];

  return (
    <div style={{ display:"flex", minHeight:"100vh", fontFamily:"system-ui,sans-serif", background:"#f9fafb" }}>
      <div style={{ width:220, background:"#111", color:"#fff", padding:"24px 0", display:"flex", flexDirection:"column", flexShrink:0, position:"sticky", top:0, height:"100vh" }}>
        <div style={{ padding:"0 20px 20px", borderBottom:"1px solid #222" }}>
          <div style={{ fontSize:15, fontWeight:800, marginBottom:2 }}>Quantitativos IA</div>
          <div style={{ fontSize:11, color:"#6b7280" }}>Medição · Orçamento · SINAPI</div>
          {sinapiRef && <div style={{ fontSize:10, color:"#22c55e", marginTop:4 }}>● SINAPI BA {sinapiRef}</div>}
        </div>
        <div style={{ padding:"12px 0" }}>
          {nav.map(item => (
            <button key={item.id} onClick={()=>setSecao(item.id)} style={{
              width:"100%", textAlign:"left", padding:"10px 20px", border:"none", cursor:"pointer",
              background: secao===item.id ? "rgba(255,255,255,0.1)" : "transparent",
              color: secao===item.id ? "#fff" : "#9ca3af",
              fontSize:13, fontWeight: secao===item.id ? 600 : 400,
              borderLeft:`3px solid ${secao===item.id?"#fff":"transparent"}`,
            }}>{item.icon} {item.label}</button>
          ))}
        </div>
        <div style={{ marginTop:"auto", padding:"16px 20px", borderTop:"1px solid #222", fontSize:11, color:"#6b7280" }}>
          <div>{clientes.length} cliente{clientes.length!==1?"s":""}</div>
          <div>{obras.length} obra{obras.length!==1?"s":""} · {totalPlanta} planta{totalPlanta!==1?"s":""}</div>
          <div>{totalItens} itens extraídos</div>
        </div>
      </div>

      <div style={{ flex:1, padding:"32px 36px", overflowX:"auto", minWidth:0 }}>
        {secao==="clientes"  && <SecaoClientes clientes={clientes} setClientes={setClientes} obras={obras} />}
        {secao==="obras"     && <SecaoObras obras={obras} setObras={setObras} clientes={clientes} />}
        {secao==="sinapi"    && <SecaoSinapi />}
        {secao==="orcamento" && <SecaoOrcamento obras={obras} />}
      </div>
    </div>
  );
}

// ─── CLIENTES ─────────────────────────────────────────────────────────────────
function SecaoClientes({ clientes, setClientes, obras }) {
  const [form, setForm]   = useState({ nome:"", tipo:"", contato:"" });
  const [editId, setEditId] = useState(null);

  const salvar = () => {
    if (!form.nome.trim()) return;
    if (editId) { setClientes(p=>p.map(c=>c.id===editId?{...c,...form}:c)); setEditId(null); }
    else          setClientes(p=>[...p, { id:uid(), ...form, criadoEm:new Date().toLocaleDateString("pt-BR") }]);
    setForm({ nome:"", tipo:"", contato:"" });
  };

  return (
    <div>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Clientes</h1>
      <p style={{ fontSize:13, color:"#6b7280", marginBottom:24 }}>Cadastre clientes e vincule obras.</p>
      <div style={{ ...S.card, padding:20, marginBottom:24 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:10, alignItems:"end" }}>
          <div><label style={S.label}>Nome *</label><input style={S.input} value={form.nome} onChange={e=>setForm(p=>({...p,nome:e.target.value}))} placeholder="BYD do Brasil" /></div>
          <div><label style={S.label}>Tipo</label><input style={S.input} value={form.tipo} onChange={e=>setForm(p=>({...p,tipo:e.target.value}))} placeholder="Industrial, Portuário..." /></div>
          <div><label style={S.label}>Contato</label><input style={S.input} value={form.contato} onChange={e=>setForm(p=>({...p,contato:e.target.value}))} placeholder="Email ou telefone" /></div>
          <button onClick={salvar} style={S.btnPrimary}>{editId?"Salvar":"Adicionar"}</button>
        </div>
        {editId && <button onClick={()=>{setEditId(null);setForm({nome:"",tipo:"",contato:""}); }} style={{ ...S.btn, marginTop:8, fontSize:12 }}>Cancelar</button>}
      </div>
      {clientes.length===0 ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:"#9ca3af" }}><div style={{ fontSize:36,marginBottom:8 }}>🏢</div><div>Nenhum cliente ainda.</div></div>
      ) : (
        <div style={{ ...S.card, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>{["Cliente","Tipo","Contato","Obras","Cadastrado",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {clientes.map(c=>(
                <tr key={c.id}>
                  <td style={{ ...S.td, fontWeight:600 }}>{c.nome}</td>
                  <td style={S.td}><span style={{ fontSize:11, padding:"2px 8px", borderRadius:20, background:"#f3f4f6" }}>{c.tipo||"—"}</span></td>
                  <td style={{ ...S.td, color:"#6b7280" }}>{c.contato||"—"}</td>
                  <td style={{ ...S.td, textAlign:"center" }}>{obras.filter(o=>o.clienteId===c.id).length}</td>
                  <td style={{ ...S.td, color:"#9ca3af" }}>{c.criadoEm}</td>
                  <td style={S.td}>
                    <button onClick={()=>{setForm({nome:c.nome,tipo:c.tipo,contato:c.contato});setEditId(c.id);}} style={{ ...S.btn, fontSize:11, padding:"4px 10px", marginRight:4 }}>Editar</button>
                    <button onClick={()=>{ if(confirm("Excluir?")) setClientes(p=>p.filter(x=>x.id!==c.id)); }} style={{ ...S.btn, fontSize:11, padding:"4px 10px", color:"#dc2626", borderColor:"#fecaca" }}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── OBRAS ────────────────────────────────────────────────────────────────────
function SecaoObras({ obras, setObras, clientes }) {
  const [obraAtiva, setObraAtiva]   = useState(null);
  const [plantaAtiva, setPlantaAtiva] = useState(null);
  const [showForm, setShowForm]     = useState(false);
  const [filtro, setFiltro]         = useState("todos");
  const [form, setForm]             = useState({ nome:"", clienteId:"", descricao:"" });

  const criar = () => {
    if (!form.nome.trim()) return;
    const nova = { id:uid(), ...form, criadoEm:new Date().toLocaleDateString("pt-BR"), plantas:[] };
    setObras(p=>[...p, nova]); setForm({ nome:"",clienteId:"",descricao:"" }); setShowForm(false); setObraAtiva(nova.id);
  };

  const obra   = obras.find(o=>o.id===obraAtiva);
  const planta = obra?.plantas?.find(p=>p.id===plantaAtiva);

  if (obra && planta) return <VisualizadorPlanta planta={planta} obra={obra} onBack={()=>setPlantaAtiva(null)} obras={obras} setObras={setObras} />;
  if (obra)           return <DetalhesObra obra={obra} obras={obras} setObras={setObras} clientes={clientes} onBack={()=>{setObraAtiva(null);setPlantaAtiva(null);}} onOpenPlanta={setPlantaAtiva} />;

  const obrasFiltradas = filtro==="todos" ? obras : obras.filter(o=>o.clienteId===filtro);

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Obras</h1>
          <p style={{ fontSize:13, color:"#6b7280" }}>Suba PDFs de plantas — a IA detecta a disciplina e extrai os quantitativos com preços SINAPI.</p>
        </div>
        <button onClick={()=>setShowForm(true)} style={S.btnPrimary}>+ Nova obra</button>
      </div>

      {showForm && (
        <div style={{ ...S.card, padding:20, marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:14 }}>Nova obra</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div><label style={S.label}>Nome *</label><input style={S.input} value={form.nome} onChange={e=>setForm(p=>({...p,nome:e.target.value}))} placeholder="Fábrica BYD — Bloco A" /></div>
            <div><label style={S.label}>Cliente</label>
              <select style={S.input} value={form.clienteId} onChange={e=>setForm(p=>({...p,clienteId:e.target.value}))}>
                <option value="">Sem cliente</option>
                {clientes.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom:12 }}><label style={S.label}>Descrição</label><input style={S.input} value={form.descricao} onChange={e=>setForm(p=>({...p,descricao:e.target.value}))} placeholder="Localização, contrato..." /></div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={criar} style={S.btnPrimary}>Criar</button>
            <button onClick={()=>setShowForm(false)} style={S.btn}>Cancelar</button>
          </div>
        </div>
      )}

      {clientes.length>0 && (
        <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
          {[{id:"todos",nome:"Todos"}, ...clientes].map(c=>(
            <button key={c.id} onClick={()=>setFiltro(c.id)} style={{ ...S.btn, fontSize:12, background:filtro===c.id?"#111":"#fff", color:filtro===c.id?"#fff":"#374151", border:`1px solid ${filtro===c.id?"#111":"#d1d5db"}` }}>{c.nome}</button>
          ))}
        </div>
      )}

      {obrasFiltradas.length===0 ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:"#9ca3af" }}><div style={{ fontSize:36,marginBottom:8 }}>🏗️</div><div>Nenhuma obra ainda.</div></div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:16 }}>
          {obrasFiltradas.map(o=>{
            const cliente = clientes.find(c=>c.id===o.clienteId);
            const nPlanta = o.plantas?.length||0;
            const nItens  = (o.plantas||[]).reduce((s,p)=>s+(p.itens?.length||0),0);
            const discs   = [...new Set((o.plantas||[]).map(p=>p.disciplina).filter(Boolean))];
            return (
              <div key={o.id} onClick={()=>setObraAtiva(o.id)} style={{ ...S.card, padding:20, cursor:"pointer" }}
                onMouseOver={e=>e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,.08)"}
                onMouseOut={e=>e.currentTarget.style.boxShadow=""}>
                {cliente && <div style={{ fontSize:11, color:"#6b7280", marginBottom:4 }}>{cliente.nome}</div>}
                <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>{o.nome}</div>
                {o.descricao && <div style={{ fontSize:12, color:"#6b7280", marginBottom:10 }}>{o.descricao}</div>}
                {discs.length>0 && (
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:10 }}>
                    {discs.map(d=>{ const c=DISC_COR[d]||{}; return <span key={d} style={{ fontSize:10, padding:"1px 7px", borderRadius:20, background:c.bg||"#f3f4f6", color:c.text||"#374151", border:`1px solid ${c.border||"#e5e7eb"}` }}>{d}</span>; })}
                  </div>
                )}
                <div style={{ display:"flex", gap:10, fontSize:12, color:"#9ca3af" }}>
                  <span>📄 {nPlanta} planta{nPlanta!==1?"s":""}</span>
                  <span>📦 {nItens} itens</span>
                  <span style={{ marginLeft:"auto" }}>{o.criadoEm}</span>
                </div>
                <button onClick={e=>{ e.stopPropagation(); if(confirm("Excluir obra?")) setObras(p=>p.filter(x=>x.id!==o.id)); }} style={{ marginTop:10, fontSize:11, color:"#dc2626", background:"none", border:"none", cursor:"pointer", padding:0 }}>Excluir</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── DETALHES DA OBRA ─────────────────────────────────────────────────────────
function DetalhesObra({ obra, obras, setObras, clientes, onBack, onOpenPlanta }) {
  const [loading,   setLoading]   = useState(false);
  const [dragOver,  setDragOver]  = useState(false);
  const [progresso, setProgresso] = useState("");
  const [erro,      setErro]      = useState("");
  const fileRef = useRef();
  const cliente = clientes.find(c=>c.id===obra.clienteId);
  const atualizar = (fn) => setObras(p=>p.map(o=>o.id===obra.id?fn(o):o));
  const obraAtual = obras.find(o=>o.id===obra.id);

  const pdfParaImagens = (file) => new Promise((resolve, reject) => {
    const go = () => {
      const lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const url = URL.createObjectURL(file);
      lib.getDocument(url).promise.then(async pdf => {
        const imgs = [];
        for (let i=1; i<=pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale:2.2 });
          const canvas = document.createElement("canvas");
          canvas.width=vp.width; canvas.height=vp.height;
          await page.render({ canvasContext:canvas.getContext("2d"), viewport:vp }).promise;
          imgs.push({ base64:canvas.toDataURL("image/jpeg",0.92).split(",")[1], type:"image/jpeg" });
        }
        URL.revokeObjectURL(url);
        resolve(imgs);
      }).catch(reject);
    };
    if (window.pdfjsLib) return go();
    const s = document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload=go; s.onerror=reject; document.head.appendChild(s);
  });

  const buscarPrecos = async (itens) => {
    const codigos = [...new Set(itens.map(i=>i.sinapi_sugerido).filter(Boolean))];
    const map = {};
    await Promise.all(codigos.map(async cod => {
      try { const r=await fetch(`/api/sinapi?codigo=${cod}`); const d=await r.json(); if(d.itens?.[0]) map[cod]=d.itens[0].preco; } catch {}
    }));
    return map;
  };

  const processar = async (files) => {
    setLoading(true); setErro("");
    for (const file of Array.from(files)) {
      try {
        // Detectar disciplina pelo nome do arquivo
        const disciplinaDetectada = detectarDisciplina(file.name);
        const prompt = getPrompt(disciplinaDetectada);

        let imgs = [];
        if (file.type==="application/pdf") {
          setProgresso(`Convertendo ${file.name}...`);
          imgs = await pdfParaImagens(file);
        } else if (file.type.startsWith("image/")) {
          imgs = [{ base64:await toBase64(file), type:file.type }];
        } else continue;

        const todosItens = [];
        let ultimoParsed = null;
        for (let i=0; i<imgs.length; i++) {
          setProgresso(`${file.name} — pág. ${i+1}/${imgs.length}${disciplinaDetectada?` · ${disciplinaDetectada}`:""}...`);
          const resp = await fetch("/api/analyze", {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({
              model:"claude-sonnet-4-20250514", max_tokens:4096, system:prompt,
              messages:[{ role:"user", content:[
                { type:"image", source:{ type:"base64", media_type:imgs[i].type, data:imgs[i].base64 } },
                { type:"text", text:`Analise esta planta${disciplinaDetectada?` de ${disciplinaDetectada}`:""}: ${file.name}${imgs.length>1?` (pág.${i+1}/${imgs.length})`:""}` }
              ]}]
            })
          });
          const data = await resp.json();
          const text = data.content?.find(b=>b.type==="text")?.text||"{}";
          const parsed = JSON.parse(text.replace(/```json|```/g,"").trim());
          todosItens.push(...(parsed.itens||[]));
          ultimoParsed = parsed;
        }

        setProgresso("Buscando preços SINAPI...");
        const precos = await buscarPrecos(todosItens);
        const itensEnriquecidos = todosItens.map(it=>({ ...it, preco_sinapi:precos[it.sinapi_sugerido]||null }));

        const novaPlanta = {
          id:uid(), fileName:file.name,
          disciplina: ultimoParsed?.disciplina || disciplinaDetectada,
          escala:ultimoParsed?.escala, resumo:ultimoParsed?.resumo,
          alertas:ultimoParsed?.alertas||[], itens:itensEnriquecidos,
          analisadoEm:new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}),
        };
        atualizar(o=>({ ...o, plantas:[...(o.plantas||[]), novaPlanta] }));
      } catch(e) { setErro("Erro: "+e.message); }
    }
    setProgresso(""); setLoading(false);
  };

  const plantas = obraAtual?.plantas||[];

  return (
    <div>
      <button onClick={onBack} style={{ ...S.btn, fontSize:12, marginBottom:20 }}>← Voltar</button>
      <div style={{ marginBottom:24 }}>
        {cliente && <div style={{ fontSize:12, color:"#6b7280", marginBottom:4 }}>{cliente.nome}</div>}
        <h1 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>{obra.nome}</h1>
        {obra.descricao && <p style={{ fontSize:13, color:"#6b7280", margin:0 }}>{obra.descricao}</p>}
      </div>

      <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:10, padding:"10px 16px", marginBottom:16, fontSize:12, color:"#166534" }}>
        💡 <strong>Detecção automática de disciplina:</strong> nomeie os arquivos com o prefixo da disciplina —
        <strong> ARQ-</strong>, <strong>ELE-</strong>, <strong>HID-</strong>, <strong>PLU-</strong>, <strong>INC-</strong>, <strong>HVA-</strong>, <strong>CFT-</strong>, <strong>VOZ-</strong>, <strong>SPD-</strong>, <strong>GAS-</strong>, <strong>EST-</strong>
      </div>

      <div onDrop={e=>{ e.preventDefault(); setDragOver(false); processar(e.dataTransfer.files); }}
        onDragOver={e=>{ e.preventDefault(); setDragOver(true); }}
        onDragLeave={()=>setDragOver(false)}
        onClick={()=>!loading&&fileRef.current?.click()}
        style={{ border:`2px dashed ${dragOver?"#2563eb":"#d1d5db"}`, borderRadius:12, padding:"28px 20px", textAlign:"center",
          cursor:loading?"wait":"pointer", background:dragOver?"#eff6ff":"#fafafa", marginBottom:24 }}>
        {loading ? (
          <div><div style={{ fontSize:28, marginBottom:8, animation:"spin 2s linear infinite", display:"inline-block" }}>⚙️</div><div style={{ fontSize:14, color:"#6b7280" }}>{progresso}</div></div>
        ) : (
          <div>
            <div style={{ fontSize:32, marginBottom:8 }}>📄</div>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Arraste as plantas aqui</div>
            <div style={{ fontSize:12, color:"#9ca3af" }}>PDF do CAD (ARQ, ELE, HID, PLU, INC, HVAC...) — a IA detecta a disciplina e aplica a análise correta</div>
          </div>
        )}
        <input ref={fileRef} type="file" multiple accept=".pdf,image/*" style={{ display:"none" }} onChange={e=>processar(e.target.files)} />
      </div>

      {erro && <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:12, color:"#dc2626" }}>{erro}</div>}

      {plantas.length===0 ? (
        <div style={{ textAlign:"center", padding:"40px 0", color:"#9ca3af", fontSize:13 }}>Nenhuma planta ainda.</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {plantas.map(p=>{
            const nItens     = p.itens?.length||0;
            const nComPreco  = p.itens?.filter(i=>i.preco_sinapi)?.length||0;
            const total      = p.itens?.reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0)||0;
            const col        = DISC_COR[p.disciplina]||{};
            return (
              <div key={p.id} onClick={()=>onOpenPlanta(p.id)} style={{ ...S.card, padding:16, display:"flex", alignItems:"center", gap:14, cursor:"pointer" }}
                onMouseOver={e=>e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,.06)"}
                onMouseOut={e=>e.currentTarget.style.boxShadow=""}>
                <div style={{ fontSize:28, flexShrink:0 }}>📐</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.fileName}</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                    {p.disciplina && <span style={{ fontSize:11, padding:"1px 8px", borderRadius:20, background:col.bg||"#f3f4f6", color:col.text||"#374151", border:`1px solid ${col.border||"#e5e7eb"}` }}>{p.disciplina}</span>}
                    {p.escala     && <span style={{ fontSize:11, color:"#9ca3af" }}>escala {p.escala}</span>}
                    <span style={{ fontSize:11, color:"#9ca3af" }}>{nItens} itens</span>
                    {nComPreco>0  && <span style={{ fontSize:11, color:"#059669" }}>{nComPreco} cotados · {fmtR(total)}</span>}
                  </div>
                </div>
                <button onClick={e=>{ e.stopPropagation(); if(confirm("Excluir?")) atualizar(o=>({...o,plantas:o.plantas.filter(x=>x.id!==p.id)})); }}
                  style={{ fontSize:13, color:"#dc2626", background:"none", border:"none", cursor:"pointer" }}>✕</button>
              </div>
            );
          })}
        </div>
      )}
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── VISUALIZADOR ─────────────────────────────────────────────────────────────
function VisualizadorPlanta({ planta, obra, onBack }) {
  const [filtro, setFiltro] = useState("Todos");
  const [bdi,    setBdi]    = useState(25);
  const itens        = planta.itens||[];
  const filtrados    = filtro==="Todos" ? itens : itens.filter(i=>i.fonte===filtro);
  const comPreco     = itens.filter(i=>i.preco_sinapi);
  const totalSemBdi  = comPreco.reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0);
  const totalComBdi  = totalSemBdi*(1+bdi/100);
  const cobertura    = itens.length ? Math.round((comPreco.length/itens.length)*100) : 0;
  const col          = DISC_COR[planta.disciplina]||{};

  const exportar = () => {
    const rows = ["\uFEFFCódigo,Descrição,Un.,Qtd.,Fonte,Cód.SINAPI,Preço Unit.,Subtotal,c/BDI,Obs."];
    filtrados.forEach(it=>{ const sub=(it.preco_sinapi||0)*(it.qtd||0); rows.push(`"${it.codigo_item}","${it.descricao}","${it.un}","${it.qtd}","${it.fonte}","${it.sinapi_sugerido||""}","${it.preco_sinapi||""}","${sub.toFixed(2)}","${(sub*(1+bdi/100)).toFixed(2)}","${it.obs||""}"`); });
    rows.push(`"","","","","","","TOTAL SEM BDI","${totalSemBdi.toFixed(2)}","",""`);
    rows.push(`"","","","","","","TOTAL COM BDI ${bdi}%","","${totalComBdi.toFixed(2)}",""`);
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv;charset=utf-8;"})); a.download=`ORC_${planta.fileName?.replace(/[^a-zA-Z0-9]/g,"_").slice(0,25)}.csv`; a.click();
  };

  return (
    <div>
      <button onClick={onBack} style={{ ...S.btn, fontSize:12, marginBottom:20 }}>← {obra.nome}</button>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
            <h1 style={{ fontSize:17, fontWeight:700, margin:0 }}>{planta.fileName}</h1>
            {planta.disciplina && <span style={{ fontSize:11, padding:"2px 9px", borderRadius:20, background:col.bg||"#f3f4f6", color:col.text||"#374151", border:`1px solid ${col.border||"#e5e7eb"}` }}>{planta.disciplina}</span>}
            {planta.escala     && <span style={{ fontSize:11, color:"#9ca3af", background:"#f9fafb", padding:"2px 8px", borderRadius:20 }}>escala {planta.escala}</span>}
          </div>
          {planta.resumo && <p style={{ fontSize:12, color:"#6b7280", margin:0, maxWidth:700 }}>{planta.resumo}</p>}
        </div>
        <button onClick={exportar} style={S.btn}>↓ CSV</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10, marginBottom:14 }}>
        {[
          { label:"Itens",           valor:itens.length,         cor:"#111" },
          { label:"SINAPI cobertos", valor:`${cobertura}%`,      cor:cobertura>=70?"#059669":"#f59e0b" },
          { label:"Total sem BDI",   valor:fmtR(totalSemBdi),    cor:"#059669" },
          { label:`Com BDI ${bdi}%`, valor:fmtR(totalComBdi),    cor:"#059669" },
        ].map(c=>(
          <div key={c.label} style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:10, padding:"11px 14px" }}>
            <div style={{ fontSize:11, color:"#6b7280", marginBottom:3 }}>{c.label}</div>
            <div style={{ fontSize:17, fontWeight:700, color:c.cor }}>{c.valor}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, flexWrap:"wrap" }}>
        <span style={{ fontSize:12, color:"#6b7280" }}>BDI:</span>
        <input type="range" min={0} max={50} value={bdi} onChange={e=>setBdi(Number(e.target.value))} style={{ width:100 }} />
        <input type="number" value={bdi} onChange={e=>setBdi(Number(e.target.value))} min={0} max={100} style={{ width:52, padding:"4px 8px", border:"1px solid #d1d5db", borderRadius:6, fontSize:13, textAlign:"center" }} />%
        <div style={{ width:1, height:18, background:"#e5e7eb", margin:"0 4px" }} />
        {Object.entries(FONTE_COR).map(([k,v])=>(
          <span key={k} onClick={()=>setFiltro(filtro===k?"Todos":k)} style={{ fontSize:11, padding:"2px 9px", borderRadius:20, background:v.bg, color:v.color, cursor:"pointer", border:filtro===k?`2px solid ${v.color}`:"1px solid transparent", fontWeight:filtro===k?600:400 }}>{k}</span>
        ))}
        {filtro!=="Todos" && <button onClick={()=>setFiltro("Todos")} style={{ ...S.btn, fontSize:11, padding:"2px 9px" }}>✕</button>}
        <span style={{ fontSize:11, color:"#9ca3af", marginLeft:"auto" }}>{filtrados.length} itens</span>
      </div>

      <div style={{ ...S.card, overflow:"hidden", marginBottom:14 }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead><tr>{["Cód.","Descrição","Un.","Qtd.","Fonte","SINAPI","Desc. SINAPI","Preço Unit.","Subtotal",`c/BDI ${bdi}%`,"Obs."].map((h,i)=>(
              <th key={h} style={{ ...S.th, textAlign:[3,7,8,9].includes(i)?"right":"left" }}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {filtrados.map((it,j)=>{
                const sub = it.preco_sinapi ? it.preco_sinapi*(it.qtd||0) : null;
                const fb  = FONTE_COR[it.fonte]||{ bg:"#f3f4f6", color:"#6b7280" };
                return (
                  <tr key={j} style={{ background:j%2===0?"#fff":"#fafafa", borderBottom:"1px solid #f3f4f6" }}>
                    <td style={{ ...S.td, fontFamily:"monospace", fontSize:10, color:"#9ca3af", whiteSpace:"nowrap" }}>{it.codigo_item}</td>
                    <td style={{ ...S.td, lineHeight:1.4, minWidth:200 }}>{it.descricao}</td>
                    <td style={{ ...S.td, textAlign:"center", color:"#6b7280" }}>{it.un}</td>
                    <td style={{ ...S.td, textAlign:"right", fontWeight:600 }}>{fmt(it.qtd)}</td>
                    <td style={{ ...S.td, whiteSpace:"nowrap" }}><span style={{ fontSize:10, padding:"2px 7px", borderRadius:20, background:fb.bg, color:fb.color }}>{it.fonte}</span></td>
                    <td style={{ ...S.td, fontFamily:"monospace", fontSize:11, color:it.sinapi_sugerido?"#2563eb":"#d1d5db", whiteSpace:"nowrap" }}>{it.sinapi_sugerido||"—"}</td>
                    <td style={{ ...S.td, fontSize:11, color:"#475569", maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{it.sinapi_descricao||"—"}</td>
                    <td style={{ ...S.td, textAlign:"right", color:it.preco_sinapi?"#059669":"#d1d5db", whiteSpace:"nowrap" }}>{it.preco_sinapi?fmtR(it.preco_sinapi):"—"}</td>
                    <td style={{ ...S.td, textAlign:"right", fontWeight:600, color:sub?"#059669":"#d1d5db", whiteSpace:"nowrap" }}>{sub!==null?fmtR(sub):"—"}</td>
                    <td style={{ ...S.td, textAlign:"right", fontWeight:600, color:sub?"#047857":"#d1d5db", whiteSpace:"nowrap" }}>{sub!==null?fmtR(sub*(1+bdi/100)):"—"}</td>
                    <td style={{ ...S.td, fontSize:11, color:"#9ca3af", minWidth:160 }}>{it.obs}</td>
                  </tr>
                );
              })}
            </tbody>
            {totalSemBdi>0 && (
              <tfoot>
                <tr style={{ background:"#f9fafb", borderTop:"2px solid #e5e7eb" }}>
                  <td colSpan={8} style={{ ...S.td, textAlign:"right", fontWeight:600, fontSize:13 }}>Total sem BDI</td>
                  <td style={{ ...S.td, textAlign:"right", fontWeight:700, color:"#059669", fontSize:13 }}>{fmtR(totalSemBdi)}</td>
                  <td colSpan={2} />
                </tr>
                <tr style={{ background:"#f0fdf4" }}>
                  <td colSpan={8} style={{ ...S.td, textAlign:"right", fontWeight:600, fontSize:13 }}>Total com BDI {bdi}%</td>
                  <td style={{ ...S.td, textAlign:"right", fontWeight:800, color:"#059669", fontSize:15 }}>{fmtR(totalComBdi)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {planta.alertas?.length>0 && (
        <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:10, padding:"12px 16px" }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#92400e", marginBottom:6 }}>⚠ Confirmar em campo</div>
          <ul style={{ margin:0, paddingLeft:18 }}>
            {planta.alertas.map((a,k)=><li key={k} style={{ fontSize:12, color:"#92400e", marginBottom:2 }}>{a}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── SINAPI ───────────────────────────────────────────────────────────────────
function SecaoSinapi() {
  const [busca,    setBusca]    = useState("");
  const [resultado,setResultado] = useState([]);
  const [info,     setInfo]     = useState(null);
  const [loading,  setLoading]  = useState(false);

  const pesquisar = async (q) => {
    setBusca(q);
    if (q.length<2) { setResultado([]); return; }
    setLoading(true);
    try {
      const r=await fetch(`/api/sinapi?q=${encodeURIComponent(q)}`);
      const d=await r.json();
      setResultado(d.itens||[]);
      if (d.referencia) setInfo(d);
    } catch {}
    setLoading(false);
  };

  const SUGESTOES = ["porcelanato","alvenaria bloco","drywall","tubulação PVC","sprinkler","detector fumaça","split","bacia","cabos","concreto FCK25","terraplenagem","telha","luminária LED"];

  return (
    <div>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>SINAPI Bahia</h1>
      <p style={{ fontSize:13, color:"#6b7280", marginBottom:24 }}>
        Consulte preços de referência.
        {info && <span style={{ color:"#059669", marginLeft:8 }}>● Ref. {info.referencia} · {info.totalItens?.toLocaleString("pt-BR")} composições</span>}
      </p>
      <div style={{ position:"relative", marginBottom:16 }}>
        <input style={{ ...S.input, paddingLeft:36, fontSize:14 }} value={busca} onChange={e=>pesquisar(e.target.value)} placeholder="Ex: porcelanato 60x60, tubo PVC 100mm, sprinkler..." />
        <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"#9ca3af" }}>🔍</span>
        {loading && <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", color:"#9ca3af", fontSize:12 }}>...</span>}
      </div>
      {resultado.length>0 ? (
        <div style={{ ...S.card, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead><tr>{["Código","Descrição","Un.","Preço Ref. (R$)"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{resultado.map((item,j)=>(
              <tr key={j} style={{ background:j%2===0?"#fff":"#fafafa" }}>
                <td style={{ ...S.td, fontFamily:"monospace", fontSize:11, color:"#2563eb", whiteSpace:"nowrap" }}>{item.codigo}</td>
                <td style={{ ...S.td, lineHeight:1.4 }}>{item.descricao}</td>
                <td style={{ ...S.td, textAlign:"center", color:"#6b7280" }}>{item.un}</td>
                <td style={{ ...S.td, textAlign:"right", fontWeight:700, color:"#059669" }}>{fmtR(item.preco)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : busca.length>=2 && !loading ? (
        <div style={{ textAlign:"center", padding:"40px 0", color:"#9ca3af", fontSize:13 }}>Nenhum resultado. Tente outro termo.</div>
      ) : (
        <div style={{ background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:10, padding:"20px 24px" }}>
          <div style={{ fontSize:12, fontWeight:600, color:"#475569", marginBottom:10 }}>Sugestões rápidas:</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {SUGESTOES.map(s=><button key={s} onClick={()=>pesquisar(s)} style={{ ...S.btn, fontSize:12, padding:"5px 12px" }}>{s}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ORÇAMENTO ────────────────────────────────────────────────────────────────
function SecaoOrcamento({ obras }) {
  const [obraId,   setObraId]   = useState("");
  const [plantaId, setPlantaId] = useState("");
  const [bdi,      setBdi]      = useState(25);

  const obra   = obras.find(o=>o.id===obraId);
  const planta = obra?.plantas?.find(p=>p.id===plantaId);
  const itens  = planta?.itens||[];
  const comPreco    = itens.filter(i=>i.preco_sinapi);
  const totalSemBdi = comPreco.reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0);
  const totalComBdi = totalSemBdi*(1+bdi/100);

  // Resumo por disciplina (quando obra selecionada sem planta)
  const todasPlantas = obra?.plantas||[];
  const resumoObra = todasPlantas.reduce((acc, p) => {
    const disc = p.disciplina||"Outros";
    if (!acc[disc]) acc[disc] = { total:0, itens:0 };
    acc[disc].itens += p.itens?.length||0;
    acc[disc].total += (p.itens||[]).reduce((s,i)=>s+(i.preco_sinapi||0)*(i.qtd||0),0);
    return acc;
  }, {});

  const exportar = () => {
    const rows = ["\uFEFFObra,Disciplina,Planta,Código,Descrição,Un.,Qtd.,Cód.SINAPI,Preço Unit.,Subtotal,c/BDI"];
    itens.forEach(it=>{ const sub=(it.preco_sinapi||0)*(it.qtd||0); rows.push(`"${obra?.nome}","${planta?.disciplina}","${planta?.fileName}","${it.codigo_item}","${it.descricao}","${it.un}","${it.qtd}","${it.sinapi_sugerido||""}","${it.preco_sinapi||""}","${sub.toFixed(2)}","${(sub*(1+bdi/100)).toFixed(2)}"`); });
    rows.push(`"","","","","","","","","TOTAL SEM BDI","${totalSemBdi.toFixed(2)}",""`);
    rows.push(`"","","","","","","","","TOTAL COM BDI ${bdi}%","","${totalComBdi.toFixed(2)}"`);
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv;charset=utf-8;"})); a.download=`ORC_${obra?.nome?.replace(/[^a-zA-Z0-9]/g,"_").slice(0,20)||"orcamento"}_BDI${bdi}.csv`; a.click();
  };

  return (
    <div>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Orçamento</h1>
      <p style={{ fontSize:13, color:"#6b7280", marginBottom:24 }}>Consolide o orçamento por obra e planta com preços SINAPI.</p>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:12, marginBottom:20, alignItems:"end" }}>
        <div><label style={S.label}>Obra</label>
          <select style={S.input} value={obraId} onChange={e=>{ setObraId(e.target.value); setPlantaId(""); }}>
            <option value="">Selecione uma obra</option>
            {obras.map(o=><option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
        </div>
        <div><label style={S.label}>Planta (opcional)</label>
          <select style={S.input} value={plantaId} onChange={e=>setPlantaId(e.target.value)} disabled={!obra}>
            <option value="">Ver resumo da obra</option>
            {(obra?.plantas||[]).map(p=><option key={p.id} value={p.id}>{p.fileName} — {p.disciplina}</option>)}
          </select>
        </div>
        <div><label style={S.label}>BDI %</label>
          <input type="number" style={{ ...S.input, width:70 }} value={bdi} onChange={e=>setBdi(Number(e.target.value))} min={0} max={100} />
        </div>
      </div>

      {/* Resumo da obra por disciplina */}
      {obra && !plantaId && Object.keys(resumoObra).length>0 && (
        <div style={{ ...S.card, overflow:"hidden", marginBottom:20 }}>
          <div style={{ padding:"12px 16px", borderBottom:"1px solid #e5e7eb", fontSize:13, fontWeight:600 }}>Resumo por disciplina — {obra.nome}</div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr>{["Disciplina","Itens","Total sem BDI",`Total c/ BDI ${bdi}%`].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {Object.entries(resumoObra).map(([d,v],j)=>{
                const col=DISC_COR[d]||{};
                return (
                  <tr key={j} style={{ background:j%2===0?"#fff":"#fafafa" }}>
                    <td style={S.td}><span style={{ fontSize:11, padding:"2px 9px", borderRadius:20, background:col.bg||"#f3f4f6", color:col.text||"#374151", border:`1px solid ${col.border||"#e5e7eb"}` }}>{d}</span></td>
                    <td style={{ ...S.td, textAlign:"center" }}>{v.itens}</td>
                    <td style={{ ...S.td, textAlign:"right", fontWeight:600, color:"#059669" }}>{fmtR(v.total)}</td>
                    <td style={{ ...S.td, textAlign:"right", fontWeight:700, color:"#047857" }}>{fmtR(v.total*(1+bdi/100))}</td>
                  </tr>
                );
              })}
              <tr style={{ background:"#f0fdf4", borderTop:"2px solid #e5e7eb" }}>
                <td style={{ ...S.td, fontWeight:700 }}>TOTAL OBRA</td>
                <td style={{ ...S.td, textAlign:"center", fontWeight:600 }}>{Object.values(resumoObra).reduce((s,v)=>s+v.itens,0)}</td>
                <td style={{ ...S.td, textAlign:"right", fontWeight:700, color:"#059669", fontSize:13 }}>{fmtR(Object.values(resumoObra).reduce((s,v)=>s+v.total,0))}</td>
                <td style={{ ...S.td, textAlign:"right", fontWeight:800, color:"#047857", fontSize:15 }}>{fmtR(Object.values(resumoObra).reduce((s,v)=>s+v.total*(1+bdi/100),0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {planta && (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:16 }}>
            {[
              { label:"Itens",          valor:itens.length },
              { label:"Com preço",      valor:`${comPreco.length}/${itens.length}` },
              { label:"Total sem BDI",  valor:fmtR(totalSemBdi) },
              { label:`BDI ${bdi}%`,    valor:fmtR(totalComBdi) },
            ].map(c=>(
              <div key={c.label} style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:10, padding:"12px 14px" }}>
                <div style={{ fontSize:11, color:"#6b7280", marginBottom:3 }}>{c.label}</div>
                <div style={{ fontSize:18, fontWeight:700 }}>{c.valor}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}>
            <button onClick={exportar} style={S.btnPrimary}>↓ Exportar CSV</button>
          </div>
          <div style={{ ...S.card, overflow:"hidden" }}>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead><tr>{["Código","Descrição","Un.","Qtd.","Cód.SINAPI","Preço Unit.","Subtotal",`c/BDI ${bdi}%`].map((h,i)=>(
                  <th key={h} style={{ ...S.th, textAlign:[3,5,6,7].includes(i)?"right":"left" }}>{h}</th>
                ))}</tr></thead>
                <tbody>
                  {itens.map((it,j)=>{ const sub=it.preco_sinapi?it.preco_sinapi*(it.qtd||0):null; return (
                    <tr key={j} style={{ background:sub?"#f0fdf4":j%2===0?"#fff":"#fafafa" }}>
                      <td style={{ ...S.td, fontFamily:"monospace", fontSize:10, color:"#9ca3af" }}>{it.codigo_item}</td>
                      <td style={{ ...S.td, lineHeight:1.4 }}>{it.descricao}</td>
                      <td style={{ ...S.td, textAlign:"center", color:"#6b7280" }}>{it.un}</td>
                      <td style={{ ...S.td, textAlign:"right", fontWeight:600 }}>{fmt(it.qtd)}</td>
                      <td style={{ ...S.td, fontFamily:"monospace", fontSize:11, color:it.sinapi_sugerido?"#2563eb":"#d1d5db" }}>{it.sinapi_sugerido||"—"}</td>
                      <td style={{ ...S.td, textAlign:"right", color:it.preco_sinapi?"#059669":"#d1d5db" }}>{it.preco_sinapi?fmtR(it.preco_sinapi):"—"}</td>
                      <td style={{ ...S.td, textAlign:"right", fontWeight:600, color:sub?"#059669":"#d1d5db" }}>{sub!==null?fmtR(sub):"—"}</td>
                      <td style={{ ...S.td, textAlign:"right", fontWeight:700, color:sub?"#047857":"#d1d5db" }}>{sub!==null?fmtR(sub*(1+bdi/100)):"—"}</td>
                    </tr>
                  ); })}
                </tbody>
                {totalSemBdi>0 && (
                  <tfoot>
                    <tr style={{ background:"#f9fafb", borderTop:"2px solid #e5e7eb" }}>
                      <td colSpan={6} style={{ ...S.td, textAlign:"right", fontWeight:600 }}>Total sem BDI</td>
                      <td style={{ ...S.td, textAlign:"right", fontWeight:700, color:"#059669", fontSize:13 }}>{fmtR(totalSemBdi)}</td>
                      <td />
                    </tr>
                    <tr style={{ background:"#f0fdf4" }}>
                      <td colSpan={6} style={{ ...S.td, textAlign:"right", fontWeight:600 }}>Total com BDI {bdi}%</td>
                      <td style={{ ...S.td, textAlign:"right", fontWeight:800, color:"#059669", fontSize:15 }}>{fmtR(totalComBdi)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {!obra && (
        <div style={{ textAlign:"center", padding:"60px 0", color:"#9ca3af" }}>
          <div style={{ fontSize:36, marginBottom:8 }}>💰</div>
          <div style={{ fontSize:14 }}>Selecione uma obra para ver o orçamento.</div>
        </div>
      )}
    </div>
  );
}
