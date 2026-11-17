<div align="center">

<h1>pai</h1>

<b>P</b>ortal-to-<b>A</b>.<b>I</b>
<br/>
<sub><i>...y a continuación, un pay:</i></sub>

<br/><br/>

<img src="./docs/pay.png" width="160" alt="un pay"/>

<br/><br/>

Servidor local que maneja chats web de IA con Playwright.
<br/>
<sub>Por el momento solo soporta <a href="https://chat.deepseek.ai">chat.deepseek.ai</a></sub>

</div>

---

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

Con el SDK de OpenAI:

```ts
const ai = new OpenAI({ baseURL: "http://127.0.0.1:3000/v1", apiKey: "pai" });
```

## DeepSeek

```bash
pnpm auth deepseek            # inicia sesión (y resuelve Cloudflare si aparece), luego ENTER
```

| Modelo                  | DeepThink | Search |
| ----------------------- | --------- | ------ |
| `deepseek/chat`         | off       | off    |
| `deepseek/think`        | on        | off    |
| `deepseek/search`       | off       | on     |
| `deepseek/think-search` | on        | on     |

- El navegador se abre con locale `en-US`: los selectores usan textos en inglés ("Message DeepSeek",
  "New chat", "Read aloud"). Si la cuenta tiene otro idioma configurado, cámbialo a inglés.
- Solo se devuelve la respuesta final (`.ds-assistant-message-main-content`); el razonamiento se descarta.
- Si Cloudflare bloquea en headless, prueba `PAI_HEADLESS=false` o `PAI_BROWSER_CHANNEL=chrome`.

## Integración con agentes de código

> [!NOTE]
> Los chats web no tienen function calling nativo, así que pai lo **emula por prompt**: si la petición
> trae `tools`, añade el catálogo y una convención (bloques ` \`\`\`tool_call ` con JSON) a las
> instrucciones, y convierte la respuesta en `tool_calls` estándar de OpenAI (`finish_reason: "tool_calls"`).
> Los resultados (`role: "tool"`) vuelven al chat como bloques `<tool_result>`. Funciona con `tool_choice`
> (`auto`, `none`, `required` o una función concreta) y `parallel_tool_calls: false`. Depende de que el
> modelo respete el formato: si no lo hace, la respuesta llega como texto normal.

Levanta primero el servidor (`pnpm start`). Si definiste `PAI_API_KEY`, úsala como API key en los
ejemplos de abajo; si no, cualquier valor sirve. Los ids disponibles salen de
`curl http://127.0.0.1:3000/v1/models`.

### OpenCode

OpenCode acepta proveedores compatibles con OpenAI. Añade esto a `opencode.json` (en el proyecto) o a
`~/.config/opencode/opencode.json` (global):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "pai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "pai",
      "options": {
        "baseURL": "http://127.0.0.1:3000/v1",
        "apiKey": "{env:PAI_API_KEY}"
      },
      "models": {
        "deepseek/chat": { "name": "DeepSeek (web)" },
        "deepseek/think": { "name": "DeepSeek DeepThink (web)" },
        "deepseek/search": { "name": "DeepSeek Search (web)" },
        "deepseek/think-search": { "name": "DeepSeek DeepThink + Search (web)" }
      }
    }
  }
}
```

Después elige el modelo con `/models` dentro de OpenCode, o arráncalo directamente:

```bash
opencode -m pai/deepseek/think
```

Para fijar una cuenta añade el sufijo al id del modelo, p. ej. `"deepseek/think@work"`.

## Contribuir con un nuevo modelo (example: `ia-3`)

1. Crea `src/providers/ia-3/` con `selectors.ts`, `pages/chat.page.ts` (extiende `BaseChatPage`) e `index.ts`:

```ts
export const provider = defineProvider({
  id: "ia-3", // igual que la carpeta
  displayName: "IA 3",
  loginUrl: "https://.../login",
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

- Tool calling emulado por prompt (ver [Integración con agentes de código](#integración-con-agentes-de-código)):
  los `tool_calls` llegan completos al final, no se transmiten mientras se generan.
- Solo texto; `temperature`, `max_tokens`, etc. se ignoran. `usage` es una estimación muy vaga, no te guies po ella.
- `stream: true` reproduce la respuesta ya completa como SSE (con keep-alive mientras se genera).
