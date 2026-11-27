# Plan: extensión FDX en Harborline

> **Historical.** Implementation plan kept for the record after the feature shipped. For current behaviour, see the design notes in [`docs/`](../README.md) and [`docs/learn/`](../learn/README.md).

Borrador. Los detalles de FDX (rutas, campos, data clusters, códigos de error, duración del consentimiento) están escritos de memoria y se verifican en la fase 0 antes de escribir código.

## Estado (25/11/2026)

Hechas: fases 0, 1, 2, 2b, 3, 4, 5 y 6. La 2b (extractos) se hizo después de integrar las demás. Falta una prueba manual en el navegador (interruptor "Use FDX", página de consentimiento y descarga de un extracto) y pasadas con un LLM real. La extensión está descrita en `docs/extensions/fdx.md`.

## Objetivo

Demostrar el patrón "estándar de dominio existente + extensión de Poppy", igual que `ucp`: Poppy pone descubrimiento, identidad del agente, Session y sign-in; FDX pone el modelo de datos. Harborline sirve una API con forma FDX sobre los mismos datos que ya tiene, y el agente la usa con un adaptador nativo en vez del adaptador OpenAPI genérico.

**v1 es solo lectura**: cuentas, saldos, movimientos, extractos (fase 2b), cliente y consentimiento. Pagos y transferencias siguen por la API propia de Harborline con Operations v3.

Qué debe quedar demostrado:

1. Un agente que no conoce la extensión sigue funcionando (§3.3: ambos lados ignoran lo que no soportan).
2. Un agente que la declara obtiene herramientas FDX nativas, con scopes por data cluster y solo las cuentas que el usuario eligió.
3. Una petición FDX sin declarar la extensión recibe `extension_required`.
4. Revocar el consentimiento FDX revoca el grant de Poppy, y al revés.

## Decisiones a validar

| Decisión                 | Recomendación                                                                                                                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nombre de la extensión   | `poppylab.dev/fdx`. Los nombres sin dominio están reservados (§3.3) y `poppylab.dev` es el dominio de despliegue del lab.                                                                                                                                                                    |
| Licencia de FDX          | No copiar al repo la OpenAPI ni los esquemas de FDX: el repo es público y la especificación FDX tiene su propia licencia. Escribir desde cero un subconjunto "con forma FDX" y no reclamar conformidad, como Harborline ya hace con la banca y con Poppy. Confirmar en la fase 0.            |
| Dos APIs en el agente    | Listar la API FDX también en `apis`, para que agentes sin la extensión puedan usarla, y en el playground mostrar las herramientas FDX solo cuando la extensión está declarada. Un interruptor en el playground ("usar FDX") hace la demo más clara que mezclar ambos juegos de herramientas. |
| Extractos                | Dejarlos para la fase 2b: exigen generar documentos (PDF) y quitar la tarea de `excludedTasks`.                                                                                                                                                                                              |
| Versión FDX que se imita | La 6.x vigente; se fija en la fase 0.                                                                                                                                                                                                                                                        |

## Hallazgos de la fase 0 (verificados el 25/11/2026)

Fuentes: la licencia de FDX (primaria), el subconjunto público de Plaid Core Exchange 6.4 y documentación de Akoya y Flinks (implementadores), y un SDK no oficial generado desde FDX 6.2. La especificación oficial requiere registro y no se ha consultado.

**Licencia.** El _FDX API License Agreement_ (15/07/2026) prohíbe copiar, crear obras derivadas y publicar la especificación o su documentación (§2.1, §2.2), y se acepta con solo acceder a ella. Por tanto:

- No entra en el repo ningún YAML, esquema ni texto descriptivo de FDX, tampoco el `corex.yaml` de Plaid, que arrastra los mismos términos.
- Escribimos a mano un subconjunto que reutiliza rutas y nombres de campo, como hacen públicamente Plaid, Akoya, Flinks y MX. Siempre lo etiquetamos como "con forma FDX, sin conformidad ni certificación", sin logotipos ni marca FDX. Que eso sea suficiente es una cuestión legal que no hemos resuelto.
- Nadie del proyecto debe registrarse para ver la especificación oficial con el fin de copiarla.

**Versión.** La última confirmada es la 6.4 (junio de 2025). `/fdx/v6` es una convención de los implementadores, no una regla de FDX. Imitamos la 6.4 y paginamos con `offset`/`limit` y `page.nextOffset`. La 6.4 los marca como obsoletos en favor de `pageKey`, pero siguen existiendo y son más simples para una demo.

**Mapeo `data.ts` → forma FDX:**

| Harborline                         | Forma FDX                                                          |
| ---------------------------------- | ------------------------------------------------------------------ |
| `Account.id`                       | `accountId`                                                        |
| —                                  | `accountCategory: "DEPOSIT_ACCOUNT"`                               |
| `type: checking / savings`         | `accountType: CHECKING / SAVINGS`                                  |
| `name`                             | `productName`, más `nickname` (no existe `displayName`)            |
| últimos dígitos derivados del id   | `accountNumberDisplay` (no existe `maskedAccountNumber`)           |
| `status: active / inactive`        | `status: OPEN / CLOSED`                                            |
| `"USD"`                            | `currency: { currencyCode: "USD" }`                                |
| `balance_cents`, `available_cents` | `currentBalance`, `availableBalance` en decimal, más `balanceAsOf` |
| `Transaction.id`                   | `transactionId`                                                    |
| `occurred_at`                      | `transactionTimestamp`, y `postedTimestamp` si está `posted`       |
| signo de `amount_cents`            | `amount` en valor absoluto, más `debitCreditMemo: DEBIT / CREDIT`  |
| `status: posted / pending`         | `status: POSTED / PENDING`                                         |
| `category`                         | `category` (texto propio de Harborline, no MCC)                    |

**Consentimiento.** El registro tiene `id`, `status` (`ACTIVE`, `EXPIRED`, `REVOKED`), `parties[]` (el banco como `DATA_PROVIDER` y el agente como `DATA_RECIPIENT`), `createdTime`, `expirationTime`, `durationType` (`TIME_BOUND`, o `ONE_TIME` sin `offline_access`), `durationPeriod` y `resources[]` (`{ resourceType: "ACCOUNT", resourceId, dataClusters }`). La revocación es `PUT /consents/{consentId}/revocation` con `{ reason: "USER_ACTION", initiator }` y responde 204.

**Clusters.** Los nombres están confirmados (`ACCOUNT_BASIC`, `ACCOUNT_DETAILED`, `TRANSACTIONS`, `CUSTOMER_CONTACT`, `STATEMENTS`…), pero sus definiciones oficiales están detrás del registro. Usamos la interpretación que publican bancos implementadores: `ACCOUNT_BASIC` son descriptores sin saldos y `ACCOUNT_DETAILED` añade los saldos. La documentamos como decisión de Harborline, no como norma FDX.

**Errores.** El cuerpo es `{ code, message, debugMessage? }`, con `code` como string. Usamos estos códigos:

| Situación                                             | Respuesta                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Cuenta inexistente o no incluida en el consentimiento | 404 `701`                                                                                               |
| Rango de fechas inválido                              | 400 `703`                                                                                               |
| Cliente no autorizado                                 | 401 `602` (solo dentro del cuerpo FDX; los errores de token siguen siendo OAuth, en `WWW-Authenticate`) |

**Seguridad.** El modelo CSDF de la 6.4 tiene un perfil "Blue" basado en FAPI 2.0. Lo que ya ofrece Harborline (PAR, PKCE, `private_key_jwt`, tokens ligados con DPoP) encaja con ese estilo, pero no está confirmado contra la especificación. Lo documentamos así.

**Contexto.** FDX abrió en abril de 2026 una iniciativa sobre IA agéntica (identidad del agente, consentimiento y delegación), sin estándar publicado todavía. `docs/extensions/fdx.md` la debe citar.

## Diseño de la extensión (v1)

**Declaración en `poppy.json`:**

```json
"extensions": {
  "operations": [{ "version": "3" }],
  "poppylab.dev/fdx": [{
    "version": "1",
    "fdx_version": "6.4",
    "base_url": "https://bank-demo.poppylab.dev/fdx/v6",
    "resources": ["customer", "accounts", "transactions"],
    "consent_endpoint": "https://bank-demo.poppylab.dev/fdx/v6/consents"
  }]
}
```

- `base_url` y `consent_endpoint` deben estar en el origen de `organization.domain`. El agente rechaza otro host y no sigue redirecciones, igual que el perfil UCP.
- Declaración: `Poppy-Extensions: "operations";v="3", "poppylab.dev/fdx";v="1"`.

**Scopes = data clusters**, con `scope_hints` `{ "changes": "none", "personal_data": true }`:

| Scope                  | Habilita                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `fdx:ACCOUNT_BASIC`    | `GET /accounts`, `GET /accounts/{id}`: id, tipo, nombre, número enmascarado, estado |
| `fdx:ACCOUNT_DETAILED` | Añade saldos (`currentBalance`, `availableBalance`) a esas respuestas               |
| `fdx:TRANSACTIONS`     | `GET /accounts/{id}/transactions`                                                   |
| `fdx:CUSTOMER_CONTACT` | `GET /customers/current`                                                            |

Son scopes aparte de `accounts:read` y demás. Un sign-in puede pedir ambos tipos.

**Consentimiento:** la página de Harborline añade la selección de cuentas cuando se piden scopes `fdx:*`. El grant guarda las cuentas elegidas, y `GET /accounts` y el resto solo ven esas. Una cuenta no elegida devuelve el error FDX de cuenta no encontrada, no 403, para no revelar que existe.

**Consent API:** `GET {consent_endpoint}/{consentId}` devuelve estado, clusters, cuentas y caducidad, que reflejan el grant. `PUT {consent_endpoint}/{consentId}/revocation` revoca el grant de Poppy. El `consentId` es el id del grant y se devuelve en la respuesta del token como campo adicional, que otros agentes ignoran.

**Seguridad:** Harborline ya ofrece PAR, DPoP, `private_key_jwt` y solo Direct Sign-In. La v1 documenta ese perfil como requisito de la extensión, sin cambiar el comportamiento actual. Activar `require_pushed_authorization_requests: true` queda como decisión aparte, porque afecta a toda la empresa.

**Errores:** en las rutas FDX, cuerpo FDX `{ code, message, debugMessage }`. Errores de token (`WWW-Authenticate`), `invalid_session`, `session_ended`, `version_unsupported` y `extension_required` siguen la especificación de Poppy (§7).

## Fases

### Fase 0: verificar FDX (S) — hecha, ver "Hallazgos de la fase 0"

- Obtener la especificación FDX 6.x y revisar su licencia.
- Confirmar rutas, nombres de campos (`accountId`, `accountCategory`, `maskedAccountNumber`, `postedTimestamp`, `debitCreditMemo`…), paginación (`offset`/`limit`, `page.nextOffset`), data clusters, códigos de error y modelo de consentimiento (`durationType`).
- Resultado: una tabla de mapeo `data.ts` → FDX en este documento.

### Fase 1: extensiones genéricas en el gateway (M)

Hoy el gateway solo entiende Operations: `Session.operations?: boolean` en `packages/pap-company/src/gateway/types.ts` y el `extension_required` fijo para `operations` en `sessions.ts`.

- `Session.extensions: Record<string, string>` (nombre → versión declarada) a partir de `parseExtensionsHeader`. `operations` pasa a ser un valor derivado, sin cambiar su comportamiento.
- `CompanyDefinition.requiredExtension?: ({ path, method }) => { name, version } | undefined`: el gateway responde `extension_required` con ese nombre cuando la petición no lo declara.
- `Grant.resources?: string[]` y `CompanyDefinition.selectResources?: ({ persona, body }) => string[] | undefined`, que se guardan en el code y luego en el grant.
- Exponer al `mount` un `grantFor(c)` con scopes, recursos, id y caducidad, para la Consent API y el filtrado de cuentas.
- Tests en `packages/pap-company`: declaración, `extension_required` genérico, recursos que llegan del consentimiento al token, y que el refresh conserva los recursos.

### Fase 2: API FDX en Harborline (M)

- `apps/harborline/src/fdx.ts`: `mountFdx(app, ctx, { customerFor })`.
  - Vistas según la tabla de mapeo de la fase 0: `Account` → cuenta de depósito con forma FDX y `Transaction` → transacción con forma FDX.
  - `GET /fdx/v6/accounts`, `/accounts/{id}`, `/accounts/{id}/transactions` (`startTime`, `endTime`, `offset`, `limit` acotado), `/customers/current`, la Consent API.
  - Saldos solo con `fdx:ACCOUNT_DETAILED`. Filtrado por las cuentas del grant.
  - `FICTION_NOTICE` en cada respuesta, como el resto de Harborline.
- `apps/harborline/src/fdx-openapi.ts`: descripción OpenAPI propia del subconjunto, servida en `/fdx/v6/openapi.json`.
- `scopes.ts` y `routeScopes`: los scopes `fdx:*` y sus rutas.
- `site.ts` (`consentPage`): fieldset de cuentas por persona. Mostrar solo las de la persona elegida con CSS (`:has()`), sin scripts. El servidor descarta las cuentas que no son de esa persona.
- `harborline.ts`: entrada de la extensión en `discovery`, segunda API en `apis`, `selectResources` y `requiredExtension` para `/fdx/`.
- Coherencia portal/API: un cambio aprobado (transferencia, categoría) se ve igual en la API propia y en la FDX.

### Fase 2b: extractos (S-M) — hecha

- Extractos mensuales derivados de los movimientos: `GET /accounts/{id}/statements` y el documento, como PDF mínimo determinista.
- Scope `fdx:STATEMENTS`. Quitar "Export statements" de `excludedTasks`, que seguiría listando los documentos fiscales.

Cómo quedó:

- **Periodos** (`apps/harborline/src/statements.ts`). Ciclos del día 21 de un mes al 20 del siguiente, en días UTC; las cuentas ficticias "se abrieron" el 21/08/2026, así que el primer ciclo cierra el 20/09/2026. Un ciclo se emite el día siguiente a su cierre y se ofrecen los doce más recientes. El 25/11/2026 hay tres por cuenta: septiembre y octubre sin movimientos y el que cierra el 20/11, con los movimientos semilla (15–19/11). Se eligió el día 20 para que los movimientos semilla caigan en un ciclo cerrado; con meses naturales noviembre aún estaría abierto. El reloj decide qué ciclos existen; el PDF de un ciclo no depende del reloj.
- **Saldos.** Se calculan hacia atrás desde `balance_cents`, que se toma como saldo contable: el cierre es el saldo actual menos lo contabilizado después del ciclo, y la apertura es el cierre menos lo contabilizado en el ciclo. Los pendientes no entran ni en los saldos ni en el extracto. Nada se inventa: un extracto muestra los movimientos reales (ficticios) de la cuenta en su periodo. Una transferencia aprobada hoy cambia el saldo actual, no un extracto cerrado.
- **PDF** (`statement-pdf.ts`). Escrito a mano, sin dependencias: PDF 1.4, Helvetica estándar con WinAnsi, contenido sin comprimir y tabla `xref` con desplazamientos exactos, sin fechas ni IDs aleatorios, así que el mismo extracto da los mismos bytes. Cabecera "Harborline Bank — fictional statement", el aviso "No real account exists." en recuadro, cuenta y últimos cuatro dígitos, cliente, periodo, saldos, créditos y débitos, y la tabla de movimientos con saldo acumulado. Como máximo 100 movimientos (lo dice si corta), repartidos en páginas, y el aviso en cada página. Unos 2,7 KB con los datos semilla; menos de 32 KB en el peor caso.
- **Rutas.** Exigen `fdx:STATEMENTS`, la extensión declarada y una cuenta elegida (si no, `701`). Un extracto desconocido es `404 statement_not_found` y un `Accept` sin PDF es `406 not_acceptable`, códigos propios de Harborline porque no hay uno FDX verificado. El PDF va con `Content-Type: application/pdf`, `Content-Disposition: attachment` y `Cache-Control: no-store`.
- **Campos.** Solo los nombres públicos `statementId`, `accountId`, `statementDate`, `description` y `status` (`AVAILABLE`), más `startDate`/`endDate`, documentados como propios de Harborline. No se ha comprobado si FDX define un campo para el periodo.
- **Cliente.** `fdx_list_statements` (paginación acotada como los movimientos, hasta 50) y `fdx_get_statement`, que comprueba que la respuesta es un PDF acotado (tipo, `%PDF-`, 512 000 bytes) y solo devuelve al modelo `{ statementId, accountId, contentType, bytes, sha256 }`. El transporte gana una opción binaria (`FdxRequestOptions`, `protocolRequest({ binary })`, `papRequest({ binary })`) con las mismas reglas de SSRF, redirecciones, DPoP y tamaño. El `Accept: application/json` por defecto ahora cede al del llamador.
- **Playground.** En la fila de la cuenta, con Use FDX y `fdx:STATEMENTS`, **Show FDX statements** (`fdx_statements`) y **Download PDF** por extracto (`fdx_statement`): la ruta valida los ids con la regla del adaptador y construye la URL solo desde la entrada validada; el navegador guarda el archivo sin diálogos y el modelo nunca recibe los bytes. En modo demo, "statements"/"extractos" lista los extractos y remite a la descarga.

### Fase 3: soporte en el cliente (M)

- `packages/pap-core/src/index.ts`: `CompanyProfile.extensions` (nombre → entrada de la versión elegida), manteniendo `operations: boolean`. Validar las URLs de la entrada FDX contra el origen de la empresa.
- `packages/pap-client/src/fdx.ts`: `fdxTools({ entry, request, trace })` → `Record<string, ApiTool>`:
  - `fdx_list_accounts`, `fdx_get_account`, `fdx_list_transactions` (con fechas y cuenta, y una paginación interna acotada en páginas y elementos), `fdx_get_customer` y `fdx_consent_status`.
  - Validar y recortar las respuestas: son contenido de la empresa (§10.1). Nunca aceptar del modelo URLs, cabeceras ni tokens.
- `headers.ts`/`extensionsHeader`: varias extensiones a la vez.
- Tests con fixtures: validación del origen, paginación acotada, respuestas malformadas, scopes que faltan.

### Fase 4: runtime y playground (S-M)

- `apps/playground/lib/runtime.ts`:
  - `sessionHeaders` declara también `poppylab.dev/fdx` cuando la empresa la lista y el interruptor está activo. Cambiarlo inicia una nueva Session (§3.4).
  - `connect()` hoy elige una sola API (la primera `openapi`). Seguir eligiendo la propia de Harborline por URL y añadir `fdxTools` cuando la extensión esté declarada.
  - Una línea de traza en el Inspector: `Extension poppylab.dev/fdx v1 · native FDX adapter`.
- Scopes que pide el agente: los `fdx:*` necesarios según la tarea (RFC 9700 §2.3).
- Modo demo sin LLM (`route.ts`, `demo-changes.ts`): reconocer "movimientos"/"saldo" y leerlos por FDX cuando esté activo. Es opcional; con LLM funciona sin esto.
- Interruptor "Usar FDX" en la UI de Harborline del playground.

### Fase 5: tests y escenarios (S)

- `apps/harborline/src/fdx.test.ts`: discovery, `extension_required`, scopes por cluster, saldos solo con `ACCOUNT_DETAILED`, cuentas no elegidas invisibles, paginación, revocación en ambos sentidos, aislamiento por visitante y coherencia con la API propia.
- `scripts/scenarios.mjs`: grupo `fdx` y añadir el test al grupo `banking`.
- Prueba de compatibilidad: un agente sin la extensión sigue usando Harborline igual que antes.

### Fase 6: documentación (S)

- `docs/extensions/fdx.md`: la extensión redactada al estilo de la especificación (declaración, scopes, consentimiento, errores, seguridad, lo que no cubre). Sirve como base de una posible propuesta upstream.
- `docs/harborline-bank.md`: sección FDX. `docs/coverage.md`, `docs/README.md` y una nota en `docs/openapi-tools.md` sobre por qué FDX usa un adaptador nativo.

## Orden y tamaño

0 → 1 → 2 → 3 → 4 → 5 se pueden hacer en ese orden, cada fase con sus tests. La 6 va al final y la 2b cuando se quiera. Tamaños relativos: S ≈ una sesión de trabajo, M ≈ dos o tres.

## Riesgos

- **Licencia FDX.** Si no permite reproducir nombres o esquemas, la API queda como "inspirada en FDX", con nombres propios y una tabla de equivalencias.
- **Mezcla de herramientas.** Con las dos APIs a la vez el modelo puede dudar entre ellas. El interruptor lo evita en la demo.
- **Cambio en el gateway.** Generalizar `Session.operations` toca Juniper, Lantern y Northwind; los tests existentes de Operations tienen que seguir pasando sin cambios.
- **Selección de cuentas.** Cambia la forma del grant. Los grants ya persistidos sin `resources` se tratan como "todas las cuentas" solo para las rutas no FDX; las rutas FDX exigen `resources`.
