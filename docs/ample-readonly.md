# Ample Computer: consentimiento MCP de solo lectura

Poppy admite ahora Direct Sign-In para los dos orígenes exactos `https://ample.computer` y `https://api.ample.computer`, vinculados exclusivamente al issuer `https://api.ample.computer/poppy` y a los endpoints públicos verificados de Ample. Esto no amplía el soporte de Operations ni permite otras Companies de infraestructura.

## Permisos y herramientas

El consentimiento pide **`servers:read budgets:read`**, nunca `servers:write`, `servers:exec`, comodines de almacenamiento ni permisos de credenciales. Una concesión que añada escritura se rechaza antes de sustituir el acceso anterior. La UI explica que Ample es una cuenta real, no una persona ficticia de Juniper.

El catálogo público observado permite verificar estas seis herramientas declaradas de lectura:

| Tool                  | Scope exigido localmente                  |
| --------------------- | ----------------------------------------- |
| `ample_server_list`   | `servers:read`                            |
| `ample_server_get`    | `servers:read`                            |
| `ample_app_list`      | `servers:read`                            |
| `ample_app_get`       | `servers:read`                            |
| `ample_budget_status` | `budgets:read`                            |
| `ample_usage_current` | `budgets:read` (restricción conservadora) |

La lista está integrada en código y no puede ampliarse con `PAP_MCP_READ_TOOLS`. Además, cada herramienta debe seguir anunciando `readOnlyHint: true` y un esquema soportado. No se exponen logs, comandos, despliegues, borrados, tokens, credenciales, workspaces ni la UI embebida de Ample.

Poppy genera `execution_key` en código, fuera del modelo (un identificador aleatorio por llamada) y oculta `execution_key` y `workspace_id` del esquema disponible al LLM. Inyectarlos manualmente se rechaza. Los argumentos normales, como el ID del servidor, siguen validándose.

La verificación del contrato público **no prueba** que un servidor remoto sea incapaz de mentir sobre los efectos de sus herramientas. La allowlist local y los scopes limitan la autoridad; no constituyen un sandbox de infraestructura.

## Flujo

1. Conecta `https://ample.computer` en Poppy.
2. Pulsa **Sign in to Ample Computer · read only** en el chat. Es una acción humana; el modelo solo puede explicar que hace falta acceso.
3. Completa el consentimiento en Ample. Poppy no recoge sus credenciales.
4. Vuelve a Poppy y pide listar apps/servidores o consultar presupuesto/consumo. No se reproduce automáticamente el mensaje anterior ni se cobra una llamada al modelo sin enviar un mensaje nuevo.
5. Si Ample concede solo uno de los scopes, las herramientas sin permiso permanecen bloqueadas. **Request remaining read access** abre un consentimiento nuevo, también de lectura.
6. **Sign out** revoca el Account Token activo y elimina las credenciales de Session cacheadas tras una respuesta satisfactoria. Las respuestas OAuth de revocación vacías HTTP 200/204 se aceptan solo en esa petición. Un fallo incierto no borra el acceso local ni provoca reintentos automáticos.

La conversación previa al primer acceso de cuenta se conserva. Los turnos privados y propuestas anteriores no atraviesan otro consentimiento, porque puede seleccionar una cuenta distinta.

## Tokens y renovación

El consentimiento usa una Session candidata nueva, PKCE S256, state y validación del issuer. La preparación no inicializa MCP ni llama herramientas remotas. Una concesión inválida deja intacto el acceso anterior.

El token general DPoP y el token MCP son distintos. Para MCP se valida la metadata de recurso, se solicita `resource=https://api.ample.computer/mcp` y se renueva usando el Account Token y sus scopes actuales. La metadata pública de Ample no anuncia DPoP para MCP, por lo que esa conexión usa Bearer; no se envía el token general al MCP. El Account Token rotado se guarda únicamente tras validar tipo, Session, duración y subconjunto de scopes. La renovación general sigue usando DPoP y no amplía scopes.

Cada nueva conexión de chat obtiene un token de recurso; no hay caché durable de Session MCP ni reanudación. Un recurso caducado durante una conexión falla con orientación para reconectar. Solo los challenges explícitos de nonce pueden repetirse una vez; las respuestas inciertas no se reintentan. Los errores explícitos de acceso no aceptado marcan la cuenta como no disponible.

## Identidad pública: relay renovado

Ample necesita verificar metadata y JWKS de Poppy mediante HTTPS público. El relay debe exponer solo identidad pública y callback fijo; **nunca el playground**.

Tras comprobar que la URL anterior no resolvía, el operador autorizó renovar el relay. La nueva identidad HTTPS responde con metadata y JWKS públicos, mantiene la misma clave de firma y admite el issuer exacto de Ample para el callback. El playground sigue bloqueado. Solo cambió `AGENT_PUBLIC_ORIGIN`; el resto del entorno se verificó idéntico mediante un fingerprint sin registrar sus valores. La URL temporal actual vive en `.env.local` ignorado y `/tmp/poppy-identity-tunnel-url.txt`, no en configuración compartida.

El cambio de origen cambia el `client_id`. Los grants anteriores no se migran ni se revocan automáticamente: inicia una conexión nueva con **Connect** antes de autorizar Ample. La prueba humana de consentimiento y lecturas privadas sigue pendiente. Véase [verificación del relay](identity-relay-renewal.md).

## Evidencia y límites

Fuentes públicas consultadas el 20 de octubre de 2026:

- [Discovery](https://api.ample.computer/.well-known/poppy.json)
- [Authorization Server Metadata](https://api.ample.computer/.well-known/oauth-authorization-server/poppy)
- [Metadata de recurso MCP](https://api.ample.computer/.well-known/oauth-protected-resource/mcp)
- [Catálogo MCP](https://api.ample.computer/mcp/catalog)
- [OpenAPI público](https://ample.computer/openapi.json), usado como evidencia complementaria de los scopes de lectura.

`apps/playground/lib/fixtures/ample-read-catalog.json` conserva solo las seis descripciones/esquemas seleccionados y el hash SHA256 del catálogo completo observado; no es un hash de release oficial. Las instrucciones remotas no se ejecutaron.

```sh
pnpm scenarios ample
```

Pruebas aisladas: issuer/endpoints exactos, consentimiento de lectura y rechazo de escritura, callback de Ample, seis herramientas con el catálogo publicado, inyección de claves/contexto rechazada, tokens de recurso, rotación, scopes reducidos, revocación, acceso rechazado y ausencia de reintentos inciertos. Suite completa: **322 tests**.

La implementación de autorización de cuenta está probada con fixtures, no con una cuenta real de Ample. En la [prueba live posterior](ample-live-preconsent.md) se verificaron discovery, respuesta con GPT-6 Luna, creación de Session previa al consentimiento y apertura del formulario real de Ample. Se detuvo antes de introducir email: no se aprobó consentimiento, no se recibió Account Token ni se leyó infraestructura privada o llamó herramientas remotas. No hubo despliegues, comandos, compras ni cambios en grants existentes. La interoperabilidad completa sigue pendiente de la autorización humana; la identidad pública ya fue comprobada accesible durante la renovación.
