# Extrator de Quantitativos — Porto Aratu ATU12

Sistema de extração de quantitativos de projetos de engenharia por IA.

## Deploy no Vercel

### 1. Criar repositório no GitHub
```bash
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/SEU_USUARIO/quantitativo-ia.git
git push -u origin main
```

### 2. Conectar ao Vercel
- Acesse vercel.com
- "Add New Project" → importe o repositório do GitHub

### 3. Configurar variável de ambiente
No painel do Vercel, em Settings → Environment Variables:
```
ANTHROPIC_API_KEY = sk-ant-...sua chave aqui...
```

### 4. Deploy
Clique em Deploy. O sistema ficará disponível em `https://SEU-PROJETO.vercel.app`

## Desenvolvimento local
```bash
npm install
# Crie um arquivo .env.local com:
# ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```
