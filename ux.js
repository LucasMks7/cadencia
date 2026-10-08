/* Cadência — camada de microinterações (sem dependências).
 * - entrada em cascata dos blocos de cada tela e de cada folha;
 * - barras de progresso que deslizam até o novo valor;
 * - comemoração (confete + vibração) quando uma trilha bate a meta do dia;
 * - tela de abertura enquanto o app carrega.
 * Tudo respeita "reduzir movimento" do sistema.
 */
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var css = [
    /* celular: o app original usa vários tamanhos fixos em px, então ampliamos tudo por igual.
       Telas estreitas (até 374px) ganham menos, para não apertar as linhas das trilhas. */
    "@media (max-width:374px){html{zoom:1.04}}",
    "@media (min-width:375px) and (max-width:540px){html{zoom:1.1}}",
    /* cascata: cada bloco da tela entra um pouco depois do anterior */
    ".screen{animation:none!important}",
    ".screen>div>*,.sheet .p-5>*{animation:uxRise .55s cubic-bezier(.22,1,.36,1) both}",
    ".screen>div>*:nth-child(2),.sheet .p-5>*:nth-child(2){animation-delay:45ms}",
    ".screen>div>*:nth-child(3),.sheet .p-5>*:nth-child(3){animation-delay:90ms}",
    ".screen>div>*:nth-child(4),.sheet .p-5>*:nth-child(4){animation-delay:135ms}",
    ".screen>div>*:nth-child(5),.sheet .p-5>*:nth-child(5){animation-delay:180ms}",
    ".screen>div>*:nth-child(6),.sheet .p-5>*:nth-child(6){animation-delay:220ms}",
    ".screen>div>*:nth-child(n+7),.sheet .p-5>*:nth-child(n+7){animation-delay:260ms}",
    "@keyframes uxRise{from{opacity:0;transform:translateY(14px) scale(.99)}to{opacity:1;transform:none}}",
    /* barras de progresso deslizam em vez de pular */
    ".screen [style*='width'][style*='%'],.sheet [style*='width'][style*='%']{transition:width .7s cubic-bezier(.22,1,.36,1)}",
    /* cartões levantam um pouco ao passar o mouse (desktop) */
    "@media (hover:hover){.card{transition:transform .2s cubic-bezier(.2,.8,.3,1),border-color .25s ease,box-shadow .25s ease}.card:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(0,0,0,.28)}}",
    /* brilho rápido no botão que acabou de bater a meta */
    ".ux-hit{animation:uxHit .7s cubic-bezier(.22,1,.36,1)}",
    "@keyframes uxHit{0%{box-shadow:0 0 0 0 var(--ux-c,#5FE3B4)}100%{box-shadow:0 0 0 16px transparent}}",
    /* tela de abertura */
    ".ux-splash{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#101119}",
    ".ux-splash i{display:block;width:56px;height:56px;border-radius:18px;background:conic-gradient(from 0deg,#5FE3B4,#A492FF,#63C7FF,#5FE3B4);animation:uxBreath 1.4s ease-in-out infinite;box-shadow:0 10px 40px rgba(164,146,255,.35)}",
    ".ux-splash b{font:900 15px Nunito,system-ui,sans-serif;color:#8B90A5;letter-spacing:.5px}",
    "@keyframes uxBreath{0%,100%{transform:scale(.92) rotate(0)}50%{transform:scale(1) rotate(8deg)}}",
    "@media (prefers-reduced-motion:reduce){.screen>div>*,.sheet .p-5>*,.ux-splash i{animation:none!important}}"
  ].join("\n");
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  /* onde foi o último toque — origem do confete */
  var lastX = innerWidth / 2, lastY = innerHeight / 2, lastEl = null;
  addEventListener("pointerdown", function (e) { lastX = e.clientX; lastY = e.clientY; lastEl = e.target.closest && e.target.closest("button"); }, { passive: true });

  function confetti(x, y, color) {
    var cv = document.createElement("canvas");
    var dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cv.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:120";
    document.body.appendChild(cv);
    var ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    var cols = [color, "#5FE3B4", "#A492FF", "#FFC85C", "#63C7FF", "#FF8FC0"], parts = [];
    for (var i = 0; i < 70; i++) {
      var a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.1, v = 4 + Math.random() * 7;
      parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .4,
        w: 5 + Math.random() * 5, h: 3 + Math.random() * 4, c: cols[i % cols.length], round: Math.random() < .3 });
    }
    var t0 = performance.now();
    (function frame(t) {
      var k = (t - t0) / 1400;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        p.vy += .22; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k * k); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h / 1.5, 0, 7); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (k < 1) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  addEventListener("cadencia:goal", function (e) {
    var c = (e.detail && e.detail.accent) || "#5FE3B4";
    if (navigator.vibrate) navigator.vibrate([10, 50, 22]);
    if (lastEl) { lastEl.style.setProperty("--ux-c", c); lastEl.classList.remove("ux-hit"); void lastEl.offsetWidth; lastEl.classList.add("ux-hit"); }
    if (!reduce) confetti(lastX, lastY, c);
  });

  /* splash: o React substitui o conteúdo do #root quando monta */
  var root = document.getElementById("root");
  if (root && !root.firstChild) root.innerHTML = '<div class="ux-splash" aria-label="carregando"><i></i><b>Cadência</b></div>';
})();
