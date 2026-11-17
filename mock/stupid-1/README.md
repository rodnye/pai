# Mock de stupid-1

Sandbox para probar `stupid-1` de forma mockeada e interceptar los prompts enviados por agentes como Claude Code/OpenCode

## Uso

```bash
# terminal 1: el mock (http://127.0.0.1:4010)
pnpm mock:stupid-1

# terminal 2: pai apuntando al mock (ya viene en .env.example)
#   PAI_STUPID1_BASE_URL=http://127.0.0.1:4010
pnpm auth stupid-1        # abre /login: pulsa "Use demo account" (demo@ia-1.test / demo1234) y ENTER en la CLI
pnpm start

curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"ia-1","messages":[{"role":"user","content":"hola, genera un gato poderoso"}]}'
```

## Qué simula

| Comportamiento         | Detalle                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login                  | `/login` con "Sign in" / "Create account". Sin sesión válida, `/` redirige a `/login`.                                                                          |
| Persistencia           | Usuarios, sesión (12 h) y chats por usuario en `localStorage`, es decir, dentro del `userDir`.                                                                  |
| New chat               | Solo crea un chat si el activo ya tiene mensajes; al cargar `/` se restaura el último chat.                                                                     |
| Respuesta              | Burbuja vacía con puntos ("pensando"), después texto palabra a palabra con el botón Stop visible.                                                               |
| Contenido              | Solo palabras del prompt (sin símbolos ni números) barajadas con una semilla derivada del prompt, con preposiciones y conjunciones intercaladas. Detecta es/en. |
| Prompt de continuación | Si el prompt trae `<current_user_message>` o `<user_message>`, solo se responde a ese bloque.                                                                   |

## Panel Debug

- **Thinking / per-token delay:** latencia de la respuesta. Sube la latencia por encima de `PAI_RESPONSE_TIMEOUT_MS` para probar timeouts.
- **Fail the next reply:** muestra un banner de error y retira la burbuja. Sirve para probar el camino de error de `ia-1`.
- **Expire session:** la siguiente acción redirige a `/login`, que es el caso de una sesión caducada.
- **Last prompts received:** lo que realmente llegó al textarea (incluidos los prompts de continuación). También disponible en `window.__ia1.prompts()`.

## Variables de entorno

| Variable           | Defecto     | Descripción                          |
| ------------------ | ----------- | ------------------------------------ |
| `MOCK_HOST`        | `127.0.0.1` | Interfaz de escucha                  |
| `MOCK_PORT`        | `4010`      | Puerto                               |
| `MOCK_THINKING_MS` | `900`       | Pausa inicial antes del primer token |
| `MOCK_TOKEN_MS`    | `45`        | Pausa media entre tokens             |

Los valores del panel Debug se guardan en el perfil y tienen prioridad sobre estas variables.
Usa "Reset everything" en el panel para volver a empezar.
