# pai

> _Portal-to-A.I_ , y a continuación, un pay:

<div align="center">
  <img src="./docs/pay.png" width="300"/>
</div>

Servidor local que maneja chats web de IA con Playwright.

Por el momento solo soporta https://chat.deepseek.ai

## Requisitos e instalación

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env
```

## Uso

```bash
pnpm auth deepseek                  # abre el navegador (no headless); ENTER guarda el userDir
pnpm auth deepseek --account work   # varias cuentas por proveedor (puedes tener multiples sesiones de un mismo proveedor)
pnpm providers                      # lista proveedores y cuentas
pnpm start                          # o pnpm serve → http://127.0.0.1:3000/v1
```

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/think","messages":[{"role":"user","content":"oh hi, generate a powerful cat"}]}'
```

Con el SDK de OpenAI: `new OpenAI({ baseURL: "http://127.0.0.1:3000/v1", apiKey: "pai" })`.

**Ids de modelo:** `modelo[/variante][@cuenta]`. `modelo` es el id del proveedor (el nombre de su
carpeta en `src/providers/`): `deepseek` (cuenta automática), `deepseek@work` (cuenta fija),
`deepseek/think-search@work` (variante propia del proveedor, vía `ChatPage.selectModel`).
`GET /v1/models` los lista.

## DeepSeek

```bash
pnpm auth deepseek            # inicia sesión (y resuelve Cloudflare si aparece), luego ENTER
```

| Modelo                  | DeepThink              | Search                 |
| ----------------------- | ---------------------- | ---------------------- |
| `deepseek`              | lo que tenga la cuenta | lo que tenga la cuenta |
| `deepseek/chat`         | off                    | off                    |
| `deepseek/think`        | on                     | off                    |
| `deepseek/search`       | off                    | on                     |
| `deepseek/think-search` | on                     | on                     |

- El navegador se abre con locale `en-US`: los selectores usan textos en inglés ("Message DeepSeek",
  "New chat", "Read aloud"). Si la cuenta tiene otro idioma configurado, cámbialo a inglés.
- Solo se devuelve la respuesta final (`.ds-assistant-message-main-content`); el razonamiento se descarta.
- Timeout propio: `PAI_DEEPSEEK_RESPONSE_TIMEOUT_MS` (por defecto ≥ 5 min).
- Si Cloudflare bloquea en headless, prueba `PAI_HEADLESS=false` o `PAI_BROWSER_CHANNEL=chrome`.
- Selectores basados en `INFORME_PLAYWRIGHT_DEEPSEEK.md`; los puntos marcados como [inferido] allí
  (estado de los toggles, "Read aloud" como señal de fin) deben validarse en vivo.

## Cómo se reanuda una sesión

1. Se calcula la huella del historial previo (todo menos el último mensaje del usuario) y se busca en
   `.pai/sessions.json` → `{ provider, account, sessionId }`.
2. Si hay coincidencia se abre `/chat/<sessionId>` **con la misma cuenta** y se verifica que el último
   mensaje del asistente en pantalla sea el esperado. Si todo cuadra, solo se envía el último mensaje.
3. Si no hay coincidencia, la URL falla (chat borrado/redirigido) o el contenido difiere (chat editado
   fuera de pai), se pulsa **New chat** y se envía un _prompt de continuación_ en XML con el historial
   (truncado por `PAI_MAX_HISTORY_CHARS`) pidiendo una respuesta limpia, sin prefijos de rol.
4. Tras responder se guarda la nueva huella (historial + respuesta), así que el siguiente turno vuelve
   a reanudar. Un fallo de verificación solo cuesta un replay, nunca una respuesta incorrecta.

## Añadir un proveedor (`ia-3`)

1. Crea `src/providers/ia-3/` con `selectors.ts`, `pages/chat.page.ts` (extiende `BaseChatPage`) e `index.ts`:

```ts
export const provider = defineProvider({
  id: "ia-3", // igual que la carpeta
  displayName: "IA 3",
  loginUrl: "https://…/login",
  createPage: (page, env) => new Ia3ChatPage(page, env),
});
export const createChatCompletion = provider.createChatCompletion;
```

2. Para sesiones reanudables sobrescribe `sessionUrl()` y `parseSessionId()` en el page object.
3. Si necesitas interceptar la red en vez de leer el `div`, sobrescribe `collectResponse()`.
4. Otros ganchos opcionales: `submit()` (clic en `selectors.sendButton` o Enter), `waitUntilReady()`
   (detectar login / captchas) y, en `defineProvider`, `variants`, `browser.locale` y `pageEnv`.

No hay que tocar el registro, el servidor ni la CLI. Las carpetas que empiezan por `_` se ignoran.

## Cuentas y concurrencia

- Cada cuenta es un `userDir`: `.pai/profiles/<provider>/<cuenta>/` (cookies, localStorage, IndexedDB).
- Un perfil de Chromium no admite dos procesos: las peticiones de una cuenta van en cola; cuentas
  distintas corren en paralelo. Sin cuenta fija se usa la que posee la sesión o la menos ocupada.
- No ejecutes `pnpm auth` sobre una cuenta que el servidor tenga abierta (usa otra cuenta o espera a que
  expire `PAI_CONTEXT_IDLE_MS`).

## Limitaciones

- Solo texto; `temperature`, `max_tokens`, etc. se ignoran. `usage` es una estimación muy vaga, no te guies po ella.
- `stream: true` reproduce la respuesta ya completa como SSE (con keep-alive mientras se genera).
