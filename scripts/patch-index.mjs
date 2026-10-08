// Aplica no index.html (bundle React já compilado) os ganchos usados por cloud.js e ux.js.
// Idempotente: se um gancho já estiver aplicado, é pulado. Uso: npm run patch
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../index.html", import.meta.url));
let html = readFileSync(file, "utf8");

const patches = [
  {
    name: "ponte de estado (window.__cad + cadencia:ready)",
    from: 'p.current=E?JSON.stringify(I):null,t(I),Em()||f("fail")})()},[]);',
    to: 'p.current=E?JSON.stringify(I):null,t(I),Em()||f("fail"),window.__cad={get:()=>p.current,apply:Q=>{let J=Us(typeof Q=="string"?JSON.parse(Q):Q),K=JSON.stringify(J);return p.current=K,t(J),zm(Kc,K),K}},window.dispatchEvent(new Event("cadencia:ready"))})()},[]);',
  },
  {
    name: "evento a cada salvamento (cadencia:save)",
    from: 'let D=async E=>{let I=await zm(Kc,E);return I?(p.current=E,f("ok")):f("fail"),I};',
    to: 'let D=async E=>{let I=await zm(Kc,E);return I?(p.current=E,f("ok")):f("fail"),window.dispatchEvent(new CustomEvent("cadencia:save",{detail:E})),I};',
  },
  {
    name: "cartão da conta em Ajustes",
    from: '{title:"Ajustes",onClose:t},',
    to: '{title:"Ajustes",onClose:t},i.default.createElement("div",{ref:Q=>{Q&&window.__cadMount&&window.__cadMount(Q)}}),',
  },
  {
    name: "avatar/estado da nuvem no topo da tela Hoje",
    from: 'i.default.createElement("button",{onClick:l,"aria-label":"ajustes",style:{background:"none",border:"none",color:m.dim,padding:8,margin:-8}},i.default.createElement(ya,{size:22}))',
    to: 'i.default.createElement("div",{className:"flex items-center",style:{gap:14}},i.default.createElement("span",{onClick:l,style:{display:"flex",cursor:"pointer"},ref:Q=>{Q&&window.__cadChip&&window.__cadChip(Q)}}),i.default.createElement("button",{onClick:l,"aria-label":"ajustes",style:{background:"none",border:"none",color:m.dim,padding:8,margin:-8}},i.default.createElement(ya,{size:22})))',
  },
  {
    name: "evento de meta do dia batida (cadencia:goal)",
    from: 'G=(E,I)=>{let xe=S.find(Be=>Be.id===E);xe&&(navigator.vibrate&&navigator.vibrate(8),L(E,F(g),ye(xe,g)+I))}',
    to: 'G=(E,I)=>{let xe=S.find(Be=>Be.id===E);if(xe){let Qa=ye(xe,g),Qb=Qa+I;navigator.vibrate&&navigator.vibrate(8),L(E,F(g),Qb),Qa<xe.dailyGoal&&Qb>=xe.dailyGoal&&window.dispatchEvent(new CustomEvent("cadencia:goal",{detail:{accent:tt(xe.accent)}}))}}',
  },
  {
    name: "tela de carregamento",
    from: 'i.default.createElement("div",{className:"flex items-center justify-center",style:{background:m.bg,minHeight:600,color:m.dim}},"carregando\\u2026")',
    to: 'i.default.createElement("div",{className:"ux-splash"},i.default.createElement("i",null),i.default.createElement("b",null,"Cad\\xEAncia"))',
  },
  {
    name: "aviso do 'Recomeçar do zero' menciona a nuvem",
    from: 'desc:"Apaga todas as trilhas, categorias e registros deste aparelho."',
    to: 'desc:"Apaga todas as trilhas, categorias e registros \\u2014 neste aparelho e, se voc\\xEA estiver conectado, na nuvem. As c\\xF3pias di\\xE1rias da nuvem continuam dispon\\xEDveis em Ajustes."',
  },
  {
    name: "títulos de trilha quebram em até 2 linhas em vez de cortar com reticências",
    all: true,
    from: 'overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"',
    to: 'overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",lineHeight:1.25,overflowWrap:"anywhere"',
  },
  {
    name: "scripts da nuvem e das animações",
    from: '<div id="root"></div>\n<script>',
    to: '<div id="root"></div>\n<script src="firebase-config.js"></script>\n<script>window.__cadQ=[];window.__cadMount=function(h){__cadQ.push(["m",h])};window.__cadChip=function(h){__cadQ.push(["c",h])};</script>\n<script src="cloud.js" defer></script>\n<script src="ux.js"></script>\n<script>',
  },
];

let changed = 0;
for (const p of patches) {
  const n = html.split(p.from).length - 1;
  // checa "já aplicado" primeiro: vários `to` contêm o próprio `from`
  if (html.includes(p.to) && !(p.all && n > 0 && !p.to.includes(p.from))) console.log("já tinha", p.name);
  else if (n === 1 || (p.all && n > 0)) { html = html.split(p.from).join(p.to); changed++; console.log("ok      ", p.name, p.all ? `(${n}x)` : ""); }
  else { console.error("FALHOU  ", p.name, `(${n} ocorrências)`); process.exitCode = 1; }
}
if (process.exitCode !== 1 && changed) writeFileSync(file, html);
console.log(changed ? `${changed} ganchos aplicados.` : "nada a fazer.");
