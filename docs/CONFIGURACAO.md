# Configuração e deploy

## Usar o app

- **Principal:** https://cadencia-app-lm.web.app (Firebase Hosting)
- **Espelho:** https://lucasmks7.github.io/cadencia/ (GitHub Pages, publicado a partir da branch `main`)

Para instalar no Android, abra no Chrome e use **⋮ → Instalar aplicativo**. No iPhone, use o Safari: **Compartilhar → Adicionar à Tela de Início**.

## Criar o seu próprio projeto Firebase

1. Em [console.firebase.google.com](https://console.firebase.google.com), crie um projeto. O Google Analytics é opcional.
2. **Authentication → Método de login → Google → Ativar**, com o e-mail de suporte.
3. **Firestore Database → Criar banco de dados**, edição Standard, em modo de produção, na região mais próxima (ex.: `southamerica-east1`).
4. **Configurações do projeto → Seus apps → Web**: registre o app e copie o `firebaseConfig` para `firebase-config.js`.
5. Publique as regras e o site:

   ```bash
   npx firebase-tools login
   npx firebase-tools use --add      # escolha o projeto
   npm run deploy                    # build + hosting + firestore.rules
   ```

6. Em `firebase-config.js`, use `authDomain: "SEU-PROJETO.web.app"`, o mesmo domínio do Hosting. O login fica em primeira parte e não depende de cookies de terceiros.
7. No [Google Cloud → Credenciais](https://console.cloud.google.com/apis/credentials), no cliente OAuth "Web client (auto created by Google Service)", adicione:
   - em **Origens JavaScript autorizadas**: `https://SEU-PROJETO.web.app`;
   - em **URIs de redirecionamento autorizados**: `https://SEU-PROJETO.web.app/__/auth/handler`.

   Sem esse passo, o login devolve `Erro 400: redirect_uri_mismatch`.
8. Se também for publicar em outro domínio (ex.: GitHub Pages), adicione-o em **Authentication → Configurações → Domínios autorizados**.

## Desenvolver sem tocar na produção

```bash
npm run emulators        # Auth (9099) + Firestore (8080) locais
```

Em `firebase-config.js`, aponte para o projeto de demonstração:

```js
window.CADENCIA_FIREBASE = { apiKey: "demo", projectId: "demo-cadencia", authDomain: "demo-cadencia.firebaseapp.com", appId: "demo", emulator: true };
```

Com `emulator: true`, o `cloud.js` conecta nos emuladores e expõe `window.__cadTestLogin(email)`, que faz login sem popup (útil para testes automatizados).

## Publicar uma nova versão

1. `npm run build`, se mexeu em `src/cloud/`.
2. Incremente `CACHE` em `sw.js` (ex.: `cadencia-v5` → `cadencia-v6`) para os aparelhos trocarem de versão na próxima abertura.
3. `npm test`.
4. `npm run deploy` (Firebase Hosting) e `git push` (GitHub Pages).

## Custos

O projeto roda no plano gratuito **Spark**: 1 GiB no Firestore, 50 mil leituras e 20 mil escritas por dia, e 10 GB de Hosting. O backup gerenciado do Firestore exige o plano pago Blaze e não é usado. Por isso, o app faz as próprias cópias diárias.
