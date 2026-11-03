# MCP: primer bloque de solo lectura

Poppy puede seleccionar MCP cuando una Company no ofrece OpenAPI. Este bloque implementa **Streamable HTTP MCP 2025-06-18**, no el transporte SSE antiguo basado en endpoints separados. Cuando hay OpenAPI y MCP, sigue prefiriendo OpenAPI.

## Implementado

- `initialize`, `notifications/initialized`, `tools/list` y `tools/call` con IDs JSON-RPC verificados, versión fija y encabezados de Session.
- Respuestas JSON o SSE finito/incremental de una petición POST. El lector cancela el stream tras recibir el resultado; no espera su cierre.
- Transporte con DNS fijado, rechazo de IPs privadas salvo excepción de desarrollo, redirects bloqueados, límites de bytes, timeout, Retry-After y un único reintento por challenge explícito de nonce. No hay reintento después de una respuesta incierta.
- Metadata RFC 9728 en `/.well-known/oauth-protected-resource<ruta-del-endpoint>`: `resource` debe coincidir exactamente con el endpoint MCP y `authorization_servers` debe incluir el issuer descubierto.
- Petición de un token separado con `resource=<url MCP>`. El tipo de token debe concordar con la metadata: DPoP si anuncia ES256, Bearer si no anuncia DPoP. El token general nunca se envía al MCP ni se sustituye por el de recurso.
- Herramientas de lectura sujetas a una allowlist local por origen exacto **y** `readOnlyHint: true`. La anotación remota por sí sola no concede autoridad. Nombres de control/despliegue/credenciales se excluyen adicionalmente.
- Validación local del subconjunto acotado de esquemas de entrada y resultados de texto. No se siguen enlaces de recursos ni imágenes. Instrucciones del servidor, sampling y elicitation no se pasan como autoridad al modelo.

## Política local

No se habilitan herramientas remotas automáticamente. Un operador debe inspeccionar el contrato y configurar nombres exactos, por ejemplo para un servidor de pruebas:

```dotenv
PAP_MCP_READ_TOOLS={"https://mcp.example":["get_catalog"]}
```

Este ejemplo **no es una configuración de Ample** ni implica que esa herramienta exista allí. El allowlist debe contener herramientas realmente verificadas como de lectura. Un servidor remoto malicioso puede mentir sobre su comportamiento: el filtro de nombres/anotaciones no es un sandbox de infraestructura ni garantiza ausencia de efectos del servidor.

Límites: 4 páginas, 100 herramientas inspeccionadas, 24 expuestas, esquemas con profundidad 4, 512KB por respuesta HTTP, 15 segundos por intercambio, 40 partes de texto y 32KB de contenido de resultado. El lector SSE no implementa suscripciones, reconexión, resumabilidad ni notificaciones persistentes. JSON-RPC batching, recursos, prompts, rich content y herramientas de escritura no están implementados. La Session MCP es transitoria por conexión; no hay reanudación ni DELETE de cierre, por lo que se depende de la caducidad del servidor.

## Límite de autorización actual

Las Companies MCP genéricas siguen limitadas a **lecturas signed-out** con política local. [Ample dispone ahora de un consentimiento específico de solo lectura](ample-readonly.md), renovación de tokens de recurso y revocación del grant activo, probados con fixtures. No hay autorización MCP genérica ni herramientas de escritura; la allowlist de propuestas no se amplía.

La metadata de recurso se busca en la ubicación well-known derivada del endpoint, no se siguen URLs arbitrarias de challenges. Se exige endpoint MCP del mismo origen que el issuer; no se soporta delegación de MCP a otro host.

Una Company remota necesita poder verificar el cliente HTTPS público. Esto no autoriza publicar el playground; sigue vigente la separación del relay público de identidad.

## Ample Computer

La discovery pública observada en `api.ample.computer` anuncia PAP 0.1, MCP y scopes propios. El [bloque de consentimiento y seis herramientas de lectura](ample-readonly.md) ya está implementado y probado de forma aislada. **Ample todavía no está validado de extremo a extremo**: falta una prueba humana real de autorización. La [identidad HTTPS pública ya se renovó y verificó](identity-relay-renewal.md). La [prueba live hasta el formulario](ample-live-preconsent.md) creó una Session previa al consentimiento y abrió el sign-in real; no autenticó una cuenta, emitió grants ni llamó herramientas privadas de Ample. Tampoco se han ejecutado despliegues, comandos ni operaciones con costes.

## Evidencia

```sh
pnpm scenarios mcp
```

26 tests de las suites MCP: 20 de cliente/transporte y 6 del runtime (incluyen las nuevas regresiones de revocación). Incluyen JSON y SSE reales sobre sockets locales, sesión, argumentos, política de lectura, metadata de recurso, DPoP/Bearer, aislamiento del token general, nonce, pérdida de conexión, redirects y límites.

Suite completa actual: **322 tests**. El grupo MCP conserva sus pruebas base; Ample añade un grupo separado. TypeScript, lint, build y formato pasan. Estos tests no certifican conformidad MCP/PAP completa ni interoperabilidad en vivo con Ample.
