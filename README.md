# Cadência

Projeta quando você termina cada curso, livro ou matéria, a partir da sua meta diária e do ritmo que você sustenta de verdade.

O app é um PWA: um site que o Android instala como aplicativo. Ícone na gaveta, tela cheia sem barra de navegador, funciona sem internet e guarda os dados no próprio aparelho.

**Demo:** [lucasmks7.github.io/cadencia](https://lucasmks7.github.io/cadencia/)

Stack: React + CSS puro, empacotado com esbuild em um único `index.html` autocontido (sem build step para rodar, sem dependências externas em runtime). Instalável como PWA (manifest + service worker), 100% client-side — os dados nunca saem do aparelho.

## Arquivos

| arquivo | o que é |
|---|---|
| `index.html` | o app inteiro (React, CSS e lógica já embutidos, 210 KB) |
| `manifest.webmanifest` | nome, cores e ícones usados na instalação |
| `sw.js` | service worker: guarda o app no aparelho para abrir offline |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | ícones |

Os seis arquivos precisam ficar na **mesma pasta**.

---

## Caminho A — GitHub Pages (recomendado)

Dá para fazer tudo pelo navegador do próprio celular.

1. Em `github.com`, crie um repositório novo, público, chamado `cadencia`.
2. **Add file → Upload files** e envie os seis arquivos. Commit.
3. **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, pasta `/ (root)`. Salve e espere cerca de um minuto.
4. Abra `https://SEU-USUARIO.github.io/cadencia/` no Chrome do celular.
5. Menu **⋮ → Instalar aplicativo** (ou *Adicionar à tela inicial*).

Pronto: o ícone aparece na gaveta de apps e, a partir da segunda abertura, funciona em modo avião.

Para atualizar o app depois, substitua o `index.html` no repositório e incremente o número de versão dentro do `sw.js` (ex.: `cadencia-v2` → `cadencia-v3`) — sem isso o celular continua servindo a versão em cache.

## Caminho B — 100% local, sem nuvem (Termux)

Instalar como aplicativo exige um contexto seguro. `file://` e `http://192.168.x.x` não servem, mas **`localhost` serve** — então um servidor rodando no próprio celular resolve.

```bash
pkg install python            # uma vez
cd /caminho/da/pasta/cadencia
python -m http.server 8080
```

No Chrome, abra `http://localhost:8080` e instale pelo menu **⋮**. Depois de instalado, o service worker já guardou tudo: pode fechar o Termux que o app continua abrindo.

## Caminho C — só para dar uma olhada

Baixe o `index.html` e abra pelo gerenciador de arquivos. O app roda, mas em `file://` o navegador não permite instalar nem registrar o service worker, e pode descartar os dados salvos. Serve para testar, não para usar.

---

## Onde ficam os dados

No `localStorage` do navegador, na chave `cadencia:v1`. Ficam no aparelho, não sobem para lugar nenhum. Limpar os dados do Chrome ou desinstalar o app apaga tudo.

Antes de mexer em qualquer coisa, use **Ajustes → Copiar backup**: ele copia um JSON com todas as trilhas e registros. Para voltar, **Ajustes → Restaurar** e cole o texto.

## Como a projeção funciona

- **Sessões necessárias** = teto(restante ÷ meta diária); o que já foi feito hoje desconta da primeira sessão.
- **Data** = a n-ésima ocorrência de um dia marcado na semana, contada a partir de hoje (ou da data de início, se a trilha for programada).
- **Ritmo real** = média móvel exponencial (α = 0,35) dos últimos 21 dias de estudo, contando os dias zerados.
- **Faixa otimista/pessimista** = ritmo real ± metade do desvio-padrão.
- **Recalibração** = meta + 0,5 × (meta necessária − meta), com salto limitado a ±25%.

## Licença

MIT — veja [LICENSE](LICENSE).
