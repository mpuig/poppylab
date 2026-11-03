# Nonces, escenarios aislados y revisiones

## Ejecutar

```sh
pnpm scenarios --list
pnpm scenarios                  # todos los grupos
pnpm scenarios nonce operations # selección
pnpm scenarios revisions        # checkout revisable y nueva Session
pnpm scenarios permissions      # lectura, ampliación y recuperación
pnpm scenarios mcp              # transporte, lectura y tokens de recurso
pnpm scenarios ample            # consentimiento, scopes y renovación Ample
```

El runner (`scripts/scenarios.mjs`) ejecuta regresiones deterministas, no modelos ni compras live. Cada ejecución crea un directorio `poppy-scenarios-*` en el temporal del sistema con reportes Vitest y `summary.json`. Estado de prueba en memoria o vaults reales en directorios temporales; no resetea `.poppy` ni modifica cuentas guardadas. Solo hereda PATH, HOME, TMPDIR, SYSTEMROOT y LANG; fuerza NODE_ENV=test y no hereda claves del modelo, contraseña Juniper ni configuración de túnel. No es una sandbox del sistema operativo ni una suite oficial de conformidad.

| Grupo      | Referencias de matriz | Escenarios                                                                                                                           |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| authority  | A04–A10, D05, O01–O07 | Consentimiento, PKCE, scopes, cuenta/Session, revocación, propuesta caducada, aprobación y aislamiento                               |
| nonce      | A02–A03               | Desafío token/API, nonce inválido/caducado/de otra clave/servidor, reintento acotado, cabecera ausente/excesiva y respuesta incierta |
| operations | O04, O07, O11         | Terms omitido, render sin datos inventados, rollback/revisión mutada, revisión 2 y aprobación nueva, recuperación por GET            |
| recovery   | A14, O07, X05         | Retry-After, vault y reinicio, pérdida de respuesta tras commit con socket y writer reales                                           |

El grupo adicional `revisions` cubre O03–O04: revisión 2 real de checkout, reanudación desde otra Session, aprobación humana nueva, concurrencia e inmutabilidad. Véase [el contrato y las pruebas](checkout-revisions.md).

El grupo `ample` ejecuta 10 tests de transporte/revocación y 53 de runtime/rutas/relay, con solapamiento entre grupos. Comprueba el contrato público de seis tools, consentimiento acotado, tokens de recurso y fallos inciertos. No concede permisos ni llama herramientas privadas en vivo. Véase [Ample de lectura](ample-readonly.md).

El grupo `mcp` ejecuta 20 tests de cliente/transporte y 6 de runtime: lectura con política local, metadata, tokens específicos DPoP/Bearer, SSE, nonce y ausencia de reintentos inciertos. No incluye inicio de sesión ni llamadas a Ample. Véase [MCP de lectura](mcp-readonly.md).

El grupo `permissions` cubre A05–A06 y recuperación: lectura inicial, consentimiento ampliado, grant anterior independiente, concesiones excesivas rechazadas, propuesta caducada y estado incierto. Véase [permisos mínimos](permission-consent.md).

Algunos tests se repiten entre grupos: los conteos del reporte no son requisitos normativos únicos. Un fallo o ausencia de reporte produce exit code 1. Un nombre desconocido produce 2. Los workers están acotados a dos por suite; la suite global también limita concurrencia para no saturar la máquina junto con otros proyectos.

## DPoP nonce

Juniper permite activar el desafío explícitamente, sin cambiar automáticamente el servidor existente:

```sh
JUNIPER_DPOP_NONCE=required pnpm dev:company
```

No ejecutar otra instancia contra el mismo vault mientras la anterior esté activa. La variable también puede configurarse al arrancar el servidor habitual. Sin ella, se conserva el comportamiento anterior; los tests de nonce la activan en su entorno aislado.

El nonce es HMAC, ligado a la clave DPoP y al ámbito token/API, válido durante 60 segundos. Cada instancia tiene un secreto aleatorio; un reinicio invalida nonces antiguos y provoca otro desafío. No se mantiene una tabla sin límite. La verificación criptográfica precede al desafío, y el desafío token ocurre antes de consumir assertions o un código OAuth. La protección de replay normal sigue vigente tras aceptar el nonce.

Poppy acepta `use_dpop_nonce` con HTTP 400/401 y una cabecera DPoP-Nonce acotada. Genera un proof nuevo y, en el token endpoint, assertions nuevas. Reenvía **una sola vez al mismo URL**, sin redirects ni transferencia del nonce a otro servidor. No reintenta ante timeout, respuesta incierta, otro código de error, nonce ausente/excesivo o un segundo desafío. Retry-After sigue aplicándose. No se hace caché de nonces en respuestas exitosas: puede haber una ida/vuelta adicional por petición.

## Operations

`terms` es opcional. Cuando falta, Poppy conserva y muestra el summary de la Company, informa de que no hay términos estructurados y no genera precios ni diferencias ficticias. La aprobación sigue siendo un botón humano, incluso con `user_approval_required:false`.

Una revisión mayor debe estar propuesta y requiere aprobación nueva. El cliente rechaza revisiones inferiores, cambios de summary/terms en la misma revisión y cambios después de finalización. Ante `terms_changed`, conserva la operación y pide Check status; obtener la revisión nueva no la confirma. El test de la ruta verifica que una aprobación de revisión 1 no puede confirmar la 2.

Juniper ahora admite [checkout revisable](checkout-revisions.md): revisión nueva sobre la misma Operation, cotización actualizada y aprobación explícita. El grupo `revisions` ejecuta handlers reales Juniper junto a la ruta Poppy, además de pruebas firmadas de Session nueva, aislamiento y reinicio con vault real. Los demás tipos de propuesta no admiten renegociación.

## Validación

322 tests locales pasan. El runner incluye ahora ocho grupos y catorce ejecuciones de suite; hay duplicados entre grupos. El grupo `revisions` contiene 30 tests de Company y 14 de Poppy. La UI summary-only se verifica por render SSR y ausencia de hechos inventados, no mediante una nueva sesión live de compra. No se confirmó ni canceló ninguna operación de Sandbox. Revisión en el mismo hilo, sin revisor independiente.
