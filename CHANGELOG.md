# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões seguem [SemVer](https://semver.org/lang/pt-BR/).

## [2.0.0] — 2026-10-08

### Adicionado
- Login com Google (Firebase Authentication) e sincronização em tempo real entre aparelhos (Cloud Firestore).
- Uso offline com fila de escrita; mesclagem automática quando dois aparelhos editam offline.
- Escolha "juntar / usar nuvem / usar aparelho" no primeiro login de um aparelho que já tinha trilhas.
- Cópias diárias na nuvem (últimos 30 dias), com restauração pelo app; opção de apagar os dados da nuvem.
- Cartão "Conta e sincronização" em Ajustes e avatar com status na tela Hoje.
- Regras de segurança do Firestore (dono, esquema e tamanho) e testes automatizados no emulador.
- Testes unitários do núcleo de sincronização e CI no GitHub Actions.
- Microinterações: entrada em cascata, barras animadas, confete e vibração ao bater a meta, tela de abertura.
- Hospedagem no Firebase Hosting, além do GitHub Pages.

### Alterado
- Escala proporcional em celulares (+4% até 374 px, +10% de 375 a 540 px).
- Títulos de trilha quebram em até duas linhas em vez de serem cortados.
- Service worker com *stale-while-revalidate*: atualizações chegam sozinhas na abertura seguinte.
- O aviso de "Recomeçar do zero" explica que, conectado, a nuvem também é apagada.

### Corrigido
- O service worker guardava em cache qualquer requisição GET, inclusive de outros domínios. Agora só os arquivos do próprio app passam por ele.

## [1.0.0] — 2026-09-11

### Adicionado
- PWA instalável e offline com projeção de término por trilha, ritmo real, simulador e agenda.
- Dados no `localStorage`, com backup e restauração manuais em JSON.
