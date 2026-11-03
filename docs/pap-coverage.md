# Matriz de cobertura PAP 0.3 — Poppy, Juniper y Lantern

Describe la implementación actual frente al **borrador PAP 0.3** y **Operations v2**. **No certifica conformidad**: es un mapa de capacidades, límites y evidencias, no un inventario de cada MUST/SHOULD. El borrador cambia a menudo (issue #60), así que la revisión normativa usa la copia descargada el 30 de octubre de 2026 (spec SHA-256 `7880e5a0…`; Operations `95a3e628…`). Son hashes de esa descarga, no de una release oficial. Detalles en [PAP 0.3](pap-03.md).

**Poppy** es el Personal Agent. **Juniper Market** (`http://juniper.localhost:4100`) y **Lantern Noodle Bar** (`http://noodles.localhost:4200`) son Companies ficticias locales que comparten un mismo gateway PAP con scopes, contratos y negocio propios. 0.1 y 0.2 ya no se admiten.

Leyenda: **I** implementado (dentro de los límites indicados) · **P** parcial · **N** no implementado · **—** no aplica. Evidencia: **A** tests automáticos · **V** comprobación en vivo documentada · **C** solo inspección de código.

Suite actual: **356 tests**; `pnpm scenarios` agrupa las pruebas por tema (`pap-0.3`, `noodles`, `permissions`, `revisions`, `operations`, `recovery`, `mcp`, `nonce`, `authority`).

## 1. Descubrimiento (§3)

| ID  | Capacidad                                                                                   | Companies | Poppy | Evidencia                                                                                            | Límites                                                                                          |
| --- | ------------------------------------------------------------------------------------------- | --------- | ----- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| D01 | `poppy.json` 0.3, versión estricta, dominio = host servido                                  | I         | I     | A: [discovery 0.3](../packages/pap-client/src/discovery03.test.ts). V: Juniper, Lantern, PAP Sandbox | Rechaza 0.1/0.2                                                                                  |
| D02 | Redirecciones solo si terminan en `/.well-known/poppy.json`                                 | —         | I     | A                                                                                                    | Sin query                                                                                        |
| D03 | Issuer desde metadata de recurso (RFC 9728); 404 = sin issuer; nunca fallback ante error    | I         | I     | A                                                                                                    | Metadata de recurso sin redirects                                                                |
| D04 | `protected_resources`, `grant_types_supported` (con `refresh_token`) y endpoints de sign-in | I         | I     | A                                                                                                    | `poppy_domains` ignorado                                                                         |
| D05 | Scopes de la Company, descripciones y `scope_hints`                                         | I         | I     | A: [permisos](../apps/playground/lib/account-permissions.test.ts)                                    | Hint desconocido = irreversible; sin hint = consecuente                                          |
| D06 | Tareas excluidas y alternativas (§9.1–9.2)                                                  | I         | I     | A. V: Sandbox Food, Juniper, Lantern                                                                 | Web solo en el dominio de la Company; tool `excluded_tasks`, marcada como contenido no confiable |
| D07 | Extensiones: Operations `"2"` en ambos lados                                                | I         | I     | A: [authority](../apps/example-company/src/authority-regression.test.ts)                             | Sin v2 → `extension_required`                                                                    |
| D08 | HTTPS y destinos privados bloqueados                                                        | I         | I     | A                                                                                                    | Excepción HTTP solo para los dos orígenes locales exactos, en desarrollo                         |

## 2. OAuth (§4)

| ID  | Capacidad                                                                                   | Companies            | Poppy | Evidencia                                                                   | Límites                                                |
| --- | ------------------------------------------------------------------------------------------- | -------------------- | ----- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| A01 | `client_id` = metadata; `private_key_jwt`; metadata sin redirects                           | I                    | I     | A                                                                           | Companies locales aceptan solo a Poppy local           |
| A02 | Direct Sign-In: PKCE S256, `iss`, `redirect_uri` exacto, sin `session_id`                   | I                    | I     | A: [callback](../apps/playground/app/api/account/callback/route.test.ts). V | —                                                      |
| A03 | Device Sign-In                                                                              | N                    | N     | Sin                                                                         | —                                                      |
| A04 | Mínimo privilegio a partir de los hints; no conceder más de lo pedido                       | I                    | I     | A                                                                           | "Lectura" = scopes `none`; "cambios" = todos           |
| A05 | Refresh dentro de los scopes actuales; `refresh_token` y `scope` opcionales en la respuesta | I                    | I     | A: [runtime](../apps/playground/lib/runtime.test.ts)                        | Toda ampliación se rechaza                             |
| A06 | Access tokens con DPoP cuando el issuer lo anuncia; Bearer si no                            | I (DPoP)             | I     | A                                                                           | Nonce DPoP opcional en Juniper                         |
| A07 | Revocación (RFC 7009) con invalidación de sus access tokens; sign-out                       | I                    | I     | A                                                                           | Se revoca el refresh token sustituido                  |
| A08 | Challenge 401 con `scope` y sin código; `insufficient_scope`; 429 con `Retry-After`         | I                    | I     | A                                                                           | `sign_in_required` y `rate_limited` eliminados         |
| A09 | Tokens por recurso para otros servicios (`resource`, `invalid_target`)                      | P (`invalid_target`) | N     | A                                                                           | Pendiente para APIs en otros orígenes y MCP con cuenta |
| A10 | Mediated Sign-In (extensión)                                                                | N                    | N     | Sin                                                                         | Transitorio en 0.3                                     |

## 3. Sessions (§5)

| ID  | Capacidad                                                                   | Companies    | Poppy                           | Evidencia                                                              | Límites                                                |
| --- | --------------------------------------------------------------------------- | ------------ | ------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| S01 | Header `Poppy-Session` por petición: `htm`/`htu`, `iat`, `jti` y `ath`      | I (verifica) | I (firma)                       | A: [session header](../packages/pap-client/src/session-header.test.ts) | Ventana de 60 s; rechazo de `jti` reutilizado opcional |
| S02 | Claves delegadas (`poppy-delegation+jwt`, ≤ 24 h, `cnf`)                    | I            | I                               | A                                                                      | Una clave por run, y por tanto por User ID             |
| S03 | `sid` aleatorio, User ID por identificador de Company                       | I            | I                               | A                                                                      | User IDs del operador local (no multiusuario)          |
| S04 | Una cuenta por Session; `invalid_session` → una Session nueva, un reintento | I            | I                               | A                                                                      | —                                                      |
| S05 | Sesiones sin cuenta, solo con el header                                     | I            | I                               | A. V                                                                   | —                                                      |
| S06 | Firmas de operador (Web Bot Auth), firma ciega PS384, Agent IDs             | N            | N / P (Agent ID en la librería) | Sin                                                                    | —                                                      |

## 4. Canales (§6–8)

| ID  | Capacidad                                                    | Companies | Poppy | Evidencia                                                                           | Límites                                            |
| --- | ------------------------------------------------------------ | --------- | ----- | ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| C01 | OpenAPI: tools acotadas generadas del contrato               | I         | I     | A: [openapi](../packages/pap-client/src/openapi.test.ts). V: GPT-6 Luna con Lantern | Subconjunto de esquemas                            |
| C02 | Autoridad de escritura fijada localmente, no por la metadata | —         | I     | A                                                                                   | Solo Companies locales y Sandbox con Operations v2 |
| C03 | MCP (Streamable HTTP), lectura sin cuenta con allowlist      | —         | P     | A: [MCP](../apps/playground/lib/mcp-runtime.test.ts)                                | Sin cuenta ni aprobación por `_meta`               |
| C04 | Navegación: browser join con código de un solo uso           | N         | N     | Sin                                                                                 | —                                                  |
| C05 | Conversaciones con el Company Agent                          | N         | N     | Sin                                                                                 | —                                                  |
| C06 | Feedback, incluida la respuesta con alternativa              | N         | N     | Sin                                                                                 | —                                                  |

## 5. Operations v2

| ID  | Capacidad                                                                                       | Companies | Poppy          | Evidencia                                                                                                      | Límites                                         |
| --- | ----------------------------------------------------------------------------------------------- | --------- | -------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| O01 | 403 `approval_required` con la operación; no se ejecuta nada                                    | I         | I              | A: [engine](../apps/example-company/src/operations-v2.test.ts), [Lantern](../apps/lantern/src/lantern.test.ts) | —                                               |
| O02 | Reintento de la misma petición con `Poppy-Approval` (RFC 9651)                                  | I         | I              | A: [cross-app](../apps/playground/app/api/account/juniper-approval.test.ts). V                                 | Solo APIs                                       |
| O03 | Mismo `operation_id` para la misma acción; revisión opaca nueva si cambian los términos         | I         | I              | A                                                                                                              | Renegociar = repetir la petición                |
| O04 | Comprobaciones: propietario, revisión devuelta y vigente, términos iguales a la petición actual | I         | —              | A                                                                                                              | —                                               |
| O05 | Nunca responder con la revisión indicada en la aprobación (sin bucles)                          | I         | I (lo detecta) | A                                                                                                              | —                                               |
| O06 | Como máximo una vez; los reintentos reciben la primera respuesta, incluso tras reiniciar        | I         | I              | A                                                                                                              | Escritor único                                  |
| O07 | Resultado incierto → reintentar solo la misma aprobación                                        | —         | I              | A: [route](../apps/playground/app/api/account/route.test.ts)                                                   | Sin 503 "en curso" en las Companies (síncronas) |
| O08 | Aprobación humana explícita; el modelo no puede aprobar; rechazar es local                      | —         | I              | A                                                                                                              | —                                               |
| O09 | Aprobaciones por MCP `_meta` y en conversaciones                                                | N         | N              | Sin                                                                                                            | —                                               |

## 6. Seguridad y límites del proyecto

- Los secretos (refresh y access tokens, Session JWTs, claves, códigos y verificadores PKCE) quedan fuera del contexto del modelo y de las trazas. Las claves de API del navegador viven solo durante la petición.
- El almacenamiento es de un solo escritor (vaults cifrados). No hay coordinación distribuida ni de rate limits.
- Es una herramienta local para un solo operador. Publicarla en `poppylab.dev` requiere identidad por visitante, límites de uso y revisión de seguridad (pendiente).
- Externos: el PAP Sandbox (proyecto independiente) sigue con Sessions 0.2 y Operations v1; Ample sigue en 0.1.
- No ha habido revisión de seguridad independiente ni conformidad oficial.

Documentos relacionados: [PAP 0.3](pap-03.md), [Lantern](lantern-noodles.md), [permisos](permission-consent.md), [MCP](mcp-readonly.md), [escenarios](scenario-lab.md). Los documentos más antiguos sobre 0.2 (por ejemplo `protocol-corrections.md` y `checkout-revisions.md`) se conservan como histórico.
