"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { SINAPI_BA, GRUPOS_SINAPI } from "../lib/sinapi";

// ─── CONSTANTES ──────────────────────────────────────────────────────────────
const DISC_COLORS = {
  "Arquitetura":           { bg:"#E6F1FB", text:"#0C447C", border:"#378ADD" },
  "Hidráulica / Pluvial":  { bg:"#EAF3DE", text:"#3B6D11", border:"#639922" },
  "Elétrica":              { bg:"#FAEEDA", text:"#854F0B", border:"#BA7517" },
  "Estrutura":             { bg:"#EEEDFE", text:"#3C3489", border:"#7F77DD" },
  "HVAC / Mecânica":       { bg:"#E1F5EE", text:"#0F6E56", border:"#1D9E75" },
  "Civil":                 { bg:"#F1EFE8", text:"#5F5E5A", border:"#888780" },
  "Tubulação Industrial":  { bg:"#FAECE7", text:"#993C1D", border:"#D85A30" },
  "Outros":                { bg:"#f3f4f6", text:"#374151", border:"#9ca3af" },
};
const FONTE_BADGE = {
  "📐 Cota":       { bg:"#E6F1FB", color:"#0C447C" },
  "🔢 Contagem":   { bg:"#EAF3DE", color:"#3B6D11" },
  "🧮 Cálculo":    { bg:"#EEEDFE", color:"#3C3489" },
  "🔍 Inferência": { bg:"#FAEEDA", color:"#854F0B" },
};
const SYSTEM_PROMPT = `Especialista em engenharia civil brasileira. Analise a imagem da planta e extraia quantitativos DO ZERO pelas cotas e elementos gráficos visíveis. NÃO use tabelas pré-preenchidas.

Para cada item identifique a FONTE:
- "📐 Cota": lido diretamente de cota no desenho
- "🔢 Contagem": símbolo contado visualmente
- "🧮 Cálculo": resultado de operação com cotas
- "🔍 Inferência": estimado por lógica construtiva

Retorne APENAS JSON:
{
  "disciplina": "Arquitetura|Hidráulica / Pluvial|Elétrica|Estrutura|HVAC / Mecânica|Civil|Tubulação Industrial|Outros",
  "escala": "1:XX",
  "resumo": "dimensões e descrição",
  "grupos": [
    { "nome": "grupo", "itens": [{"codigo":"XXX-001","descricao":"...","un":"m²|m|un|kg|m³","qtd":0,"fonte":"📐 Cota","obs":"como medido"}] }
  ],
  "alertas": ["confirmar em campo"]
}`;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n) => typeof n === "number" ? n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : n;
const fmtR = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const toBase64 = (f) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(f);
});

// ─── ESTILOS BASE ─────────────────────────────────────────────────────────────
const S = {
  card:   { background:"#fff", border:"1px solid #e5e7eb", borderRadius:12 },
  input:  { width:"100%", padding:"8px 12px", border:"1px solid #d1d5db", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" },
  btn:    { padding:"8px 16px", border:"1px solid #d1d5db", borderRadius:8, background:"#fff", cursor:"pointer", fontSize:13, fontWeight:500 },
  btnPrimary: { padding:"8px 16px", border:"none", borderRadius:8, background:"#111", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:500 },
  th:     { padding:"8px 12px", textAlign:"left", fontWeight:600, color:"#6b7280", fontSize:11, borderBottom:"1px solid #e5e7eb", background:"#f9fafb", whiteSpace:"nowrap" },
  td:     { padding:"8px 12px", fontSize:12, borderBottom:"1px solid #f3f4f6", verticalAlign:"top" },
  label:  { fontSize:12, fontWeight:500, color:"#374151", display:"block", marginBottom:4 },
};

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function QuantitativoApp() {
  const [secao, setSecao] = useState("obras");
  const [clientes, setClientes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("qt_clientes") || "[]"); } catch { return []; }
  });
  const [obras, setObras] = useState(() => {
    try { return JSON.parse(localStorage.getItem("qt_obras") || "[]"); } catch { return []; }
  });

  useEffect(() => { localStorage.setItem("qt_clientes", JSON.stringify(clientes)); }, [clientes]);
  useEffect(() => { localStorage.setItem("qt_obras", JSON.stringify(obras)); }, [obras]);

  const totalItens = obras.reduce((s, o) => s + (o.plantas || []).reduce((ss, p) => ss + ((p.grupos || []).reduce((sss, g) => sss + g.itens.length, 0)), ss), 0);

  return (
    <div style={{ display:"flex", minHeight:"100vh", fontFamily:"system-ui,sans-serif", background:"#f9fafb" }}>
      {/* ── SIDEBAR ── */}
      <div style={{ width:220, background:"#111", color:"#fff", padding:"24px 0", display:"flex", flexDirection:"column", flexShrink:0, position:"sticky", top:0, height:"100vh" }}>
        <div style={{ padding:"0 20px 24px" }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:2 }}>Quantitativos</div>
          <div style={{ fontSize:11, color:"#9ca3af" }}>Porto Aratu · BYD · Obras</div>
        </div>
        {[
          { id:"obras",    label:"Obras",         icon:"🏗️" },
          { id:"clientes", label:"Clientes",      icon:"🏢" },
          { id:"sinapi",   label:"SINAPI Bahia",  icon:"📋" },
          { id:"orcamento",label:"Orçamento",     icon:"💰" },
        ].map(item => (
          <button key={item.id} onClick={() => setSecao(item.id)} style={{
            width:"100%", textAlign:"left", padding:"10px 20px", border:"none", cursor:"pointer",
            background: secao === item.id ? "rgba(255,255,255,0.12)" : "transparent",
            color: secao === item.id ? "#fff" : "#9ca3af",
            fontSize:13, fontWeight: secao === item.id ? 600 : 400,
            borderLeft: secao === item.id ? "3px solid #fff" : "3px solid transparent",
          }}>
            {item.icon} {item.label}
          </button>
        ))}
        <div style={{ marginTop:"auto", padding:"0 20px", fontSize:11, color:"#6b7280" }}>
          <div>{clientes.length} clientes</div>
          <div>{obras.length} obras · {totalItens} itens</div>
        </div>
      </div>

      {/* ── CONTEÚDO ── */}
      <div style={{ flex:1, padding:"32px 36px", overflowX:"auto" }}>
        {secao === "clientes" && <SecaoClientes clientes={clientes} setClientes={setClientes} obras={obras} />}
        {secao === "obras"    && <SecaoObras obras={obras} setObras={setObras} clientes={clientes} />}
        {secao === "sinapi"   && <SecaoSinapi />}
        {secao === "orcamento"&& <SecaoOrcamento obras={obras} setObras={setObras} />}
      </div>
    </div>
  );
}

// ─── CLIENTES ─────────────────────────────────────────────────────────────────
function SecaoClientes({ clientes, setClientes, obras }) {
  const [form, setForm] = useState({ nome:"", tipo:"", contato:"" });
  const [editId, setEditId] = useState(null);

  const salvar = () => {
    if (!form.nome.trim()) return;
    if (editId) {
      setClientes(p => p.map(c => c.id === editId ? { ...c, ...form } : c));
      setEditId(null);
    } else {
      setClientes(p => [...p, { id: uid(), ...form, criadoEm: new Date().toLocaleDateString("pt-BR") }]);
    }
    setForm({ nome:"", tipo:"", contato:"" });
  };
  const excluir = (id) => {
    if (confirm("Excluir cliente?")) setClientes(p => p.filter(c => c.id !== id));
  };
  const editar = (c) => { setForm({ nome: c.nome, tipo: c.tipo, contato: c.contato }); setEditId(c.id); };

  return (
    <div>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Clientes</h1>
      <p style={{ fontSize:13, color:"#6b7280", marginBottom:24 }}>Gerencie os clientes e vincule obras a cada um.</p>

      <div style={{ ...S.card, padding:20, marginBottom:24 }}>
        <div style={{ fontSize:14, fontWeight:600, marginBottom:16 }}>{editId ? "Editar cliente" : "Novo cliente"}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:12, alignItems:"end" }}>
          <div><label style={S.label}>Nome *</label><input style={S.input} value={form.nome} onChange={e => setForm(p => ({...p, nome:e.target.value}))} placeholder="Ex: BYD do Brasil" /></div>
          <div><label style={S.label}>Tipo</label><input style={S.input} value={form.tipo} onChange={e => setForm(p => ({...p, tipo:e.target.value}))} placeholder="Industrial, Portuário..." /></div>
          <div><label style={S.label}>Contato</label><input style={S.input} value={form.contato} onChange={e => setForm(p => ({...p, contato:e.target.value}))} placeholder="Email ou telefone" /></div>
          <button onClick={salvar} style={S.btnPrimary}>{editId ? "Salvar" : "Adicionar"}</button>
        </div>
        {editId && <button onClick={() => { setEditId(null); setForm({ nome:"", tipo:"", contato:"" }); }} style={{ ...S.btn, marginTop:8, fontSize:12 }}>Cancelar</button>}
      </div>

      {clientes.length === 0 ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:"#9ca3af" }}>
          <div style={{ fontSize:32, marginBottom:8 }}>🏢</div>
          <div>Nenhum cliente cadastrado ainda.</div>
        </div>
      ) : (
        <div style={{ ...S.card, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>{["Cliente","Tipo","Contato","Obras","Cadastro",""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {clientes.map(c => (
                <tr key={c.id}>
                  <td style={{ ...S.td, fontWeight:600 }}>{c.nome}</td>
                  <td style={S.td}><span style={{ fontSize:11, padding:"2px 8px", borderRadius:20, background:"#f3f4f6" }}>{c.tipo || "—"}</span></td>
                  <td style={{ ...S.td, color:"#6b7280" }}>{c.contato || "—"}</td>
                  <td style={{ ...S.td, textAlign:"center" }}>{obras.filter(o => o.clienteId === c.id).length}</td>
                  <td style={{ ...S.td, color:"#9ca3af" }}>{c.criadoEm}</td>
                  <td style={S.td}>
                    <button onClick={() => editar(c)} style={{ ...S.btn, fontSize:11, padding:"4px 10px", marginRight:4 }}>Editar</button>
                    <button onClick={() => excluir(c.id)} style={{ ...S.btn, fontSize:11, padding:"4px 10px", color:"#dc2626", borderColor:"#fecaca" }}>Excluir</button>
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
  const [obraAtiva, setObraAtiva] = useState(null);
  const [plantaAtiva, setPlantaAtiva] = useState(null);
  const [filtroCliente, setFiltroCliente] = useState("todos");
  const [showNovaObra, setShowNovaObra] = useState(false);
  const [form, setForm] = useState({ nome:"", clienteId:"", descricao:"" });

  const criarObra = () => {
    if (!form.nome.trim()) return;
    const nova = { id: uid(), ...form, criadoEm: new Date().toLocaleDateString("pt-BR"), plantas: [] };
    setObras(p => [...p, nova]);
    setForm({ nome:"", clienteId:"", descricao:"" });
    setShowNovaObra(false);
    setObraAtiva(nova.id);
  };

  const excluirObra = (id) => {
    if (confirm("Excluir obra e todas as plantas?")) {
      setObras(p => p.filter(o => o.id !== id));
      if (obraAtiva === id) { setObraAtiva(null); setPlantaAtiva(null); }
    }
  };

  const obrasFiltradas = filtroCliente === "todos" ? obras : obras.filter(o => o.clienteId === filtroCliente);
  const obra = obras.find(o => o.id === obraAtiva);
  const planta = obra?.plantas?.find(p => p.id === plantaAtiva);

  if (obra && planta) {
    return <VisualizadorPlanta planta={planta} obra={obra} onBack={() => setPlantaAtiva(null)} obras={obras} setObras={setObras} />;
  }

  if (obra) {
    return <DetalhesObra obra={obra} obras={obras} setObras={setObras} onBack={() => setObraAtiva(null)} onOpenPlanta={setPlantaAtiva} clientes={clientes} />;
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Obras</h1>
          <p style={{ fontSize:13, color:"#6b7280" }}>Suba PDFs de plantas e extraia quantitativos por IA.</p>
        </div>
        <button onClick={() => setShowNovaObra(true)} style={S.btnPrimary}>+ Nova obra</button>
      </div>

      {showNovaObra && (
        <div style={{ ...S.card, padding:20, marginBottom:24 }}>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:16 }}>Nova obra</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div><label style={S.label}>Nome da obra *</label><input style={S.input} value={form.nome} onChange={e => setForm(p => ({...p, nome:e.target.value}))} placeholder="Ex: Fábrica BYD — Bloco A" /></div>
            <div>
              <label style={S.label}>Cliente</label>
              <select style={S.input} value={form.clienteId} onChange={e => setForm(p => ({...p, clienteId:e.target.value}))}>
                <option value="">Sem cliente</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom:12 }}><label style={S.label}>Descrição</label><input style={S.input} value={form.descricao} onChange={e => setForm(p => ({...p, descricao:e.target.value}))} placeholder="Localização, escopo..." /></div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={criarObra} style={S.btnPrimary}>Criar obra</button>
            <button onClick={() => setShowNovaObra(false)} style={S.btn}>Cancelar</button>
          </div>
        </div>
      )}

      {clientes.length > 0 && (
        <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
          {[{ id:"todos", nome:"Todos os clientes" }, ...clientes].map(c => (
            <button key={c.id} onClick={() => setFiltroCliente(c.id)} style={{
              ...S.btn, fontSize:12,
              background: filtroCliente === c.id ? "#111" : "#fff",
              color: filtroCliente === c.id ? "#fff" : "#374151",
              border: `1px solid ${filtroCliente === c.id ? "#111" : "#d1d5db"}`,
            }}>{c.nome}</button>
          ))}
        </div>
      )}

      {obrasFiltradas.length === 0 ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:"#9ca3af" }}>
          <div style={{ fontSize:32, marginBottom:8 }}>🏗️</div>
          <div>Nenhuma obra ainda. Crie a primeira!</div>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))", gap:16 }}>
          {obrasFiltradas.map(o => {
            const cliente = clientes.find(c => c.id === o.clienteId);
            const nPlanta = o.plantas?.length || 0;
            const nItens = (o.plantas || []).reduce((s, p) => s + (p.grupos || []).reduce((ss, g) => ss + g.itens.length, ss), 0);
            return (
              <div key={o.id} style={{ ...S.card, padding:20, cursor:"pointer" }} onClick={() => setObraAtiva(o.id)}>
                {cliente && <div style={{ fontSize:11, color:"#6b7280", marginBottom:6 }}>{cliente.nome}</div>}
                <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>{o.nome}</div>
                {o.descricao && <div style={{ fontSize:12, color:"#6b7280", marginBottom:12 }}>{o.descricao}</div>}
                <div style={{ display:"flex", gap:12, fontSize:12, color:"#9ca3af" }}>
                  <span>📄 {nPlanta} planta{nPlanta !== 1 ? "s" : ""}</span>
                  <span>📦 {nItens} itens</span>
                  <span style={{ marginLeft:"auto" }}>{o.criadoEm}</span>
                </div>
                <button onClick={e => { e.stopPropagation(); excluirObra(o.id); }} style={{ marginTop:12, fontSize:11, color:"#dc2626", background:"none", border:"none", cursor:"pointer", padding:0 }}>Excluir obra</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── DETALHES DA OBRA ─────────────────────────────────────────────────────────
function DetalhesObra({ obra, obras, setObras, onBack, onOpenPlanta, clientes }) {
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progresso, setProgresso] = useState("");
  const fileRef = useRef();
  const cliente = clientes.find(c => c.id === obra.clienteId);

  const atualizarObra = (fn) => setObras(p => p.map(o => o.id === obra.id ? fn(o) : o));

  const pdfToImages = async (file) => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = async () => {
        try {
          const pdfjsLib = window.pdfjsLib;
          pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          const pdf = await pdfjsLib.getDocument(url).promise;
          const images = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width; canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            images.push({ base64: canvas.toDataURL("image/jpeg", 0.92).split(",")[1], type: "image/jpeg" });
          }
          URL.revokeObjectURL(url);
          resolve(images);
        } catch (e) { reject(e); }
      };
      script.onerror = reject;
      if (!window.pdfjsLib) document.head.appendChild(script);
      else script.onload();
    });
  };

  const processarArquivos = async (files) => {
    setLoading(true);
    for (const file of Array.from(files)) {
      try {
        let imagens = [];
        if (file.type === "application/pdf") {
          setProgresso(`Convertendo ${file.name}...`);
          imagens = await pdfToImages(file);
        } else if (file.type.startsWith("image/")) {
          const base64 = await toBase64(file);
          imagens = [{ base64, type: file.type }];
        } else continue;

        for (let i = 0; i < imagens.length; i++) {
          setProgresso(`Analisando ${file.name} — página ${i + 1}/${imagens.length}...`);
          const img = imagens[i];
          const resp = await fetch("/api/analyze", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514", max_tokens: 4000, system: SYSTEM_PROMPT,
              messages: [{ role: "user", content: [
                { type: "image", source: { type: "base64", media_type: img.type, data: img.base64 } },
                { type: "text", text: `Analise esta planta: ${file.name} (página ${i + 1})` }
              ]}]
            })
          });
          const data = await resp.json();
          const text = data.content?.find(b => b.type === "text")?.text || "{}";
          const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
          const novaPlanta = { id: uid(), fileName: `${file.name}${imagens.length > 1 ? ` — pág.${i+1}` : ""}`, ...parsed };
          atualizarObra(o => ({ ...o, plantas: [...(o.plantas || []), novaPlanta] }));
        }
      } catch (e) { alert("Erro ao processar " + file.name + ": " + e.message); }
    }
    setProgresso(""); setLoading(false);
  };

  const excluirPlanta = (pid) => {
    if (confirm("Excluir esta planta?")) atualizarObra(o => ({ ...o, plantas: o.plantas.filter(p => p.id !== pid) }));
  };

  const obraAtual = obras.find(o => o.id === obra.id);
  const plantas = obraAtual?.plantas || [];

  return (
    <div>
      <button onClick={onBack} style={{ ...S.btn, fontSize:12, marginBottom:20 }}>← Voltar para obras</button>
      <div style={{ marginBottom:24 }}>
        {cliente && <div style={{ fontSize:12, color:"#6b7280", marginBottom:4 }}>{cliente.nome}</div>}
        <h1 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>{obra.nome}</h1>
        {obra.descricao && <p style={{ fontSize:13, color:"#6b7280" }}>{obra.descricao}</p>}
      </div>

      <div
        onDrop={e => { e.preventDefault(); setDragOver(false); processarArquivos(e.dataTransfer.files); }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => !loading && fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#2563eb" : "#d1d5db"}`, borderRadius:12, padding:"28px 20px",
          textAlign:"center", cursor: loading ? "wait" : "pointer",
          background: dragOver ? "#eff6ff" : "#fafafa", marginBottom:24, transition:"all .15s"
        }}>
        {loading ? (
          <div><div style={{ fontSize:20, marginBottom:8 }}>⏳</div><div style={{ fontSize:13, color:"#6b7280" }}>{progresso || "Analisando..."}</div></div>
        ) : (
          <div>
            <div style={{ fontSize:28, marginBottom:8 }}>📄</div>
            <div style={{ fontSize:14, fontWeight:500, marginBottom:4 }}>Arraste PDFs ou imagens aqui</div>
            <div style={{ fontSize:12, color:"#9ca3af" }}>PDF do CAD, PNG ou JPG — cada página vira um quantitativo</div>
          </div>
        )}
        <input ref={fileRef} type="file" multiple accept=".pdf,image/*" style={{ display:"none" }}
          onChange={e => processarArquivos(e.target.files)} />
      </div>

      {plantas.length === 0 ? (
        <div style={{ textAlign:"center", padding:"40px 0", color:"#9ca3af", fontSize:13 }}>Nenhuma planta ainda. Suba um PDF ou imagem acima.</div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {plantas.map(p => {
            const nItens = (p.grupos || []).reduce((s, g) => s + g.itens.length, 0);
            const col = DISC_COLORS[p.disciplina] || DISC_COLORS["Outros"];
            return (
              <div key={p.id} style={{ ...S.card, padding:16, display:"flex", alignItems:"center", gap:16, cursor:"pointer" }}
                onClick={() => onOpenPlanta(p.id)}>
                <div style={{ fontSize:24 }}>📐</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.fileName}</div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    <span style={{ fontSize:11, padding:"1px 8px", borderRadius:20, background:col.bg, color:col.text, border:`1px solid ${col.border}` }}>{p.disciplina}</span>
                    {p.escala && <span style={{ fontSize:11, color:"#9ca3af" }}>escala {p.escala}</span>}
                    <span style={{ fontSize:11, color:"#9ca3af" }}>{nItens} itens</span>
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); excluirPlanta(p.id); }}
                  style={{ fontSize:11, color:"#dc2626", background:"none", border:"none", cursor:"pointer" }}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── VISUALIZADOR DE PLANTA ───────────────────────────────────────────────────
function VisualizadorPlanta({ planta, obra, onBack, obras, setObras }) {
  const [filtroFonte, setFiltroFonte] = useState("Todos");

  const allItens = (planta.grupos || []).flatMap(g => g.itens.map(it => ({ ...it, grupo: g.nome })));
  const itensFiltrados = filtroFonte === "Todos" ? allItens : allItens.filter(i => i.fonte === filtroFonte);
  const col = DISC_COLORS[planta.disciplina] || DISC_COLORS["Outros"];

  const exportCSV = () => {
    const rows = ["\uFEFFCódigo,Grupo,Descrição,Un.,Qtd.,Fonte,Observação"];
    itensFiltrados.forEach(it => rows.push(`"${it.codigo}","${it.grupo}","${it.descricao}","${it.un}","${it.qtd}","${it.fonte}","${it.obs || ""}"`));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" }));
    a.download = `QT_${planta.fileName?.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}.csv`;
    a.click();
  };

  return (
    <div>
      <button onClick={onBack} style={{ ...S.btn, fontSize:12, marginBottom:20 }}>← Voltar para {obra.nome}</button>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6, flexWrap:"wrap" }}>
            <h1 style={{ fontSize:18, fontWeight:700, margin:0 }}>{planta.fileName}</h1>
            <span style={{ fontSize:11, padding:"2px 8px", borderRadius:20, background:col.bg, color:col.text, border:`1px solid ${col.border}` }}>{planta.disciplina}</span>
            {planta.escala && <span style={{ fontSize:11, color:"#9ca3af", background:"#f3f4f6", padding:"2px 8px", borderRadius:20 }}>escala {planta.escala}</span>}
          </div>
          <p style={{ fontSize:12, color:"#6b7280", margin:0 }}>{planta.resumo}</p>
        </div>
        <button onClick={exportCSV} style={S.btn}>↓ Exportar CSV</button>
      </div>

      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:12, color:"#6b7280" }}>Filtrar:</span>
        {Object.entries(FONTE_BADGE).map(([k, v]) => (
          <span key={k} onClick={() => setFiltroFonte(filtroFonte === k ? "Todos" : k)}
            style={{ fontSize:11, padding:"3px 10px", borderRadius:20, background:v.bg, color:v.color, cursor:"pointer",
              border: filtroFonte === k ? `2px solid ${v.color}` : "1px solid transparent",
              fontWeight: filtroFonte === k ? 600 : 400 }}>{k}</span>
        ))}
        {filtroFonte !== "Todos" && <button onClick={() => setFiltroFonte("Todos")} style={{ ...S.btn, fontSize:11, padding:"3px 10px" }}>✕</button>}
        <span style={{ fontSize:11, color:"#9ca3af", marginLeft:"auto" }}>{itensFiltrados.length} itens</span>
      </div>

      <div style={{ ...S.card, overflow:"hidden", marginBottom:16 }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead><tr>{["Código","Grupo","Descrição","Un.","Qtd.","Fonte","Como foi medido"].map((h, i) =>
              <th key={h} style={{ ...S.th, textAlign: i >= 3 && i <= 4 ? "center" : "left" }}>{h}</th>)}</tr></thead>
            <tbody>
              {itensFiltrados.map((it, j) => {
                const fb = FONTE_BADGE[it.fonte] || { bg:"#f3f4f6", color:"#6b7280" };
                return (
                  <tr key={j} style={{ background: j % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ ...S.td, fontFamily:"monospace", fontSize:10, color:"#9ca3af", whiteSpace:"nowrap" }}>{it.codigo}</td>
                    <td style={{ ...S.td, fontSize:11, color:"#6b7280", whiteSpace:"nowrap" }}>{it.grupo}</td>
                    <td style={{ ...S.td, lineHeight:1.4 }}>{it.descricao}</td>
                    <td style={{ ...S.td, textAlign:"center", color:"#6b7280" }}>{it.un}</td>
                    <td style={{ ...S.td, textAlign:"center", fontWeight:600 }}>{fmt(it.qtd)}</td>
                    <td style={{ ...S.td, whiteSpace:"nowrap" }}>
                      <span style={{ fontSize:10, padding:"2px 8px", borderRadius:20, background:fb.bg, color:fb.color }}>{it.fonte}</span>
                    </td>
                    <td style={{ ...S.td, color:"#6b7280", minWidth:200 }}>{it.obs}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {planta.alertas?.length > 0 && (
        <div style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:10, padding:"12px 16px" }}>
          <div style={{ fontSize:12, fontWeight:600, color:"#92400e", marginBottom:6 }}>⚠ Confirmar em campo</div>
          <ul style={{ margin:0, paddingLeft:16 }}>
            {planta.alertas.map((a, k) => <li key={k} style={{ fontSize:12, color:"#92400e", marginBottom:2 }}>{a}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── SINAPI ───────────────────────────────────────────────────────────────────
function SecaoSinapi() {
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState("Todos");

  const resultado = SINAPI_BA.filter(i => {
    const q = busca.toLowerCase();
    const matchTexto = !busca || i.descricao.toLowerCase().includes(q) || i.codigo.includes(q);
    const matchGrupo = grupo === "Todos" || i.grupo === grupo;
    return matchTexto && matchGrupo;
  });

  return (
    <div>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>SINAPI Bahia</h1>
      <p style={{ fontSize:13, color:"#6b7280", marginBottom:24 }}>Base de referência de preços — Bahia 2026 (Não Desonerada). {SINAPI_BA.length} composições.</p>

      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:12, marginBottom:16 }}>
        <input style={S.input} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por código ou descrição... Ex: porcelanato, PVC 100mm, alvenaria" />
        <select style={{ ...S.input, width:"auto" }} value={grupo} onChange={e => setGrupo(e.target.value)}>
          <option value="Todos">Todos os grupos</option>
          {GRUPOS_SINAPI.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      <div style={{ fontSize:12, color:"#9ca3af", marginBottom:12 }}>{resultado.length} resultado{resultado.length !== 1 ? "s" : ""}</div>

      <div style={{ ...S.card, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead><tr>{["Código SINAPI","Grupo","Descrição","Un.","Preço Unit. (R$)"].map(h =>
              <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {resultado.slice(0, 200).map((item, j) => (
                <tr key={j} style={{ background: j % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ ...S.td, fontFamily:"monospace", fontSize:11, color:"#6b7280", whiteSpace:"nowrap" }}>{item.codigo}</td>
                  <td style={S.td}><span style={{ fontSize:11, padding:"2px 8px", borderRadius:20, background:"#f3f4f6", whiteSpace:"nowrap" }}>{item.grupo}</span></td>
                  <td style={{ ...S.td, lineHeight:1.4 }}>{item.descricao}</td>
                  <td style={{ ...S.td, textAlign:"center", color:"#6b7280" }}>{item.un}</td>
                  <td style={{ ...S.td, textAlign:"right", fontWeight:600, color:"#059669", whiteSpace:"nowrap" }}>{fmtR(item.preco)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── ORÇAMENTO ────────────────────────────────────────────────────────────────
function SecaoOrcamento({ obras, setObras }) {
  const [obraId, setObraId] = useState("");
  const [plantaId, setPlantaId] = useState("");
  const [bdi, setBdi] = useState(25);
  const [vinculos, setVinculos] = useState({});
  const [busca, setBusca] = useState({});

  const obra = obras.find(o => o.id === obraId);
  const planta = obra?.plantas?.find(p => p.id === plantaId);
  const allItens = planta ? (planta.grupos || []).flatMap(g => g.itens.map(it => ({ ...it, grupo: g.nome }))) : [];

  const setVinculo = (codigo, sinapiCodigo) => setVinculos(p => ({ ...p, [codigo]: sinapiCodigo }));
  const setBuscaItem = (codigo, v) => setBusca(p => ({ ...p, [codigo]: v }));

  const total = allItens.reduce((s, it) => {
    const sinapi = SINAPI_BA.find(s => s.codigo === vinculos[it.codigo]);
    if (!sinapi) return s;
    return s + (it.qtd || 0) * sinapi.preco;
  }, 0);
  const totalComBDI = total * (1 + bdi / 100);
  const itensVinculados = allItens.filter(it => vinculos[it.codigo]).length;

  const exportOrcamento = () => {
    const rows = ["\uFEFFCódigo,Grupo,Descrição,Un.,Qtd.,Código SINAPI,Preço Unit.,Subtotal,Subtotal c/ BDI"];
    allItens.forEach(it => {
      const sinapi = SINAPI_BA.find(s => s.codigo === vinculos[it.codigo]);
      const sub = sinapi ? (it.qtd || 0) * sinapi.preco : 0;
      rows.push(`"${it.codigo}","${it.grupo}","${it.descricao}","${it.un}","${it.qtd}","${vinculos[it.codigo] || ""}","${sinapi ? sinapi.preco : ""}","${sub.toFixed(2)}","${(sub * (1 + bdi / 100)).toFixed(2)}"`);
    });
    rows.push(`"","","","","","","TOTAL SEM BDI","${total.toFixed(2)}",""`);
    rows.push(`"","","","","","","TOTAL COM BDI ${bdi}%","","${totalComBDI.toFixed(2)}"`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" }));
    a.download = `ORC_${obra?.nome?.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20) || "orcamento"}.csv`;
    a.click();
  };

  return (
    <div>
      <h1 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Orçamento</h1>
      <p style={{ fontSize:13, color:"#6b7280", marginBottom:24 }}>Vincule os itens extraídos aos códigos SINAPI e gere o orçamento.</p>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:12, marginBottom:24, alignItems:"end" }}>
        <div>
          <label style={S.label}>Obra</label>
          <select style={S.input} value={obraId} onChange={e => { setObraId(e.target.value); setPlantaId(""); setVinculos({}); }}>
            <option value="">Selecione uma obra</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Planta</label>
          <select style={S.input} value={plantaId} onChange={e => { setPlantaId(e.target.value); setVinculos({}); }} disabled={!obra}>
            <option value="">Selecione uma planta</option>
            {(obra?.plantas || []).map(p => <option key={p.id} value={p.id}>{p.fileName}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>BDI (%)</label>
          <input type="number" style={{ ...S.input, width:80 }} value={bdi} onChange={e => setBdi(Number(e.target.value))} min={0} max={100} />
        </div>
      </div>

      {planta && (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
            {[
              { label:"Itens na planta",   value: allItens.length },
              { label:"Itens vinculados",  value: `${itensVinculados} / ${allItens.length}` },
              { label:"Total sem BDI",     value: fmtR(total) },
              { label:`Total c/ BDI ${bdi}%`, value: fmtR(totalComBDI) },
            ].map(m => (
              <div key={m.label} style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:10, padding:"12px 16px" }}>
                <div style={{ fontSize:11, color:"#6b7280", marginBottom:4 }}>{m.label}</div>
                <div style={{ fontSize:18, fontWeight:700 }}>{m.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}>
            <button onClick={exportOrcamento} style={S.btnPrimary}>↓ Exportar orçamento CSV</button>
          </div>

          <div style={{ ...S.card, overflow:"hidden" }}>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead><tr>{["Código","Grupo","Descrição","Un.","Qtd.","Vincular SINAPI","Preço Unit.","Subtotal"].map(h =>
                  <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {allItens.map((it, j) => {
                    const sinapi = SINAPI_BA.find(s => s.codigo === vinculos[it.codigo]);
                    const resultado = (busca[it.codigo] || "").length > 1
                      ? SINAPI_BA.filter(s => s.descricao.toLowerCase().includes((busca[it.codigo] || "").toLowerCase()) || s.codigo.includes(busca[it.codigo] || "")).slice(0, 8)
                      : [];
                    const sub = sinapi ? (it.qtd || 0) * sinapi.preco : null;
                    return (
                      <tr key={j} style={{ background: sinapi ? "#f0fdf4" : j % 2 === 0 ? "#fff" : "#fafafa" }}>
                        <td style={{ ...S.td, fontFamily:"monospace", fontSize:10, color:"#9ca3af" }}>{it.codigo}</td>
                        <td style={{ ...S.td, fontSize:11, color:"#6b7280", whiteSpace:"nowrap" }}>{it.grupo}</td>
                        <td style={{ ...S.td, lineHeight:1.4 }}>{it.descricao}</td>
                        <td style={{ ...S.td, textAlign:"center", color:"#6b7280" }}>{it.un}</td>
                        <td style={{ ...S.td, textAlign:"center", fontWeight:600 }}>{fmt(it.qtd)}</td>
                        <td style={{ ...S.td, minWidth:240, position:"relative" }}>
                          {sinapi ? (
                            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                              <span style={{ fontSize:11, fontFamily:"monospace", color:"#059669" }}>{sinapi.codigo}</span>
                              <span style={{ fontSize:10, color:"#6b7280", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:120 }}>{sinapi.descricao}</span>
                              <button onClick={() => setVinculo(it.codigo, null)} style={{ fontSize:10, color:"#dc2626", background:"none", border:"none", cursor:"pointer", flexShrink:0 }}>✕</button>
                            </div>
                          ) : (
                            <div>
                              <input
                                style={{ ...S.input, fontSize:11, padding:"4px 8px" }}
                                placeholder="Buscar no SINAPI..."
                                value={busca[it.codigo] || ""}
                                onChange={e => setBuscaItem(it.codigo, e.target.value)}
                              />
                              {resultado.length > 0 && (
                                <div style={{ position:"absolute", zIndex:100, background:"#fff", border:"1px solid #e5e7eb", borderRadius:8, boxShadow:"0 4px 12px rgba(0,0,0,.1)", left:0, right:0, top:"100%", maxHeight:200, overflowY:"auto" }}>
                                  {resultado.map(s => (
                                    <div key={s.codigo} onClick={() => { setVinculo(it.codigo, s.codigo); setBuscaItem(it.codigo, ""); }}
                                      style={{ padding:"8px 12px", cursor:"pointer", fontSize:11, borderBottom:"1px solid #f3f4f6" }}
                                      onMouseOver={e => e.currentTarget.style.background = "#f9fafb"}
                                      onMouseOut={e => e.currentTarget.style.background = ""}>
                                      <span style={{ fontFamily:"monospace", color:"#6b7280", marginRight:8 }}>{s.codigo}</span>
                                      {s.descricao.substring(0, 60)}...
                                      <span style={{ float:"right", color:"#059669", fontWeight:600 }}>{fmtR(s.preco)}/{s.un}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ ...S.td, textAlign:"right", color:"#6b7280" }}>{sinapi ? fmtR(sinapi.preco) : "—"}</td>
                        <td style={{ ...S.td, textAlign:"right", fontWeight:600, color: sub ? "#059669" : "#9ca3af" }}>{sub !== null ? fmtR(sub) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {total > 0 && (
                  <tfoot>
                    <tr style={{ background:"#f9fafb", borderTop:"2px solid #e5e7eb" }}>
                      <td colSpan={7} style={{ ...S.td, textAlign:"right", fontWeight:600 }}>Total sem BDI</td>
                      <td style={{ ...S.td, textAlign:"right", fontWeight:700, color:"#059669" }}>{fmtR(total)}</td>
                    </tr>
                    <tr style={{ background:"#f0fdf4" }}>
                      <td colSpan={7} style={{ ...S.td, textAlign:"right", fontWeight:600 }}>Total com BDI {bdi}%</td>
                      <td style={{ ...S.td, textAlign:"right", fontWeight:700, fontSize:14, color:"#059669" }}>{fmtR(totalComBDI)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {!planta && (
        <div style={{ textAlign:"center", padding:"60px 0", color:"#9ca3af" }}>
          <div style={{ fontSize:32, marginBottom:8 }}>💰</div>
          <div>Selecione uma obra e uma planta para montar o orçamento.</div>
        </div>
      )}
    </div>
  );
}
