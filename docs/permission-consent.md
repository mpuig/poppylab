# Permisos mínimos y recuperación de cuenta

## Lectura primero

Poppy solicita `poppy:read` al pulsar Sign in. Una cuenta de lectura puede consultar datos, pero no proponer ni confirmar cambios. El control **Request change permission** abre otro consentimiento, ahora para `poppy:read poppy:write`. Solo se ofrece si la Company anuncia escritura; el servidor también verifica los scopes anunciados antes de construir la autorización. No se añaden scopes nuevos ni permisos por servicio.

La ruta humana acepta `access: "read"` (por defecto) o `access: "write"` (lectura + escritura), no scopes arbitrarios. Ninguna tool del modelo inicia este consentimiento. El bloqueo por scope indica qué control debe usar el usuario, sin cerrar su acceso de lectura.

Juniper acepta los subconjuntos no vacíos de sus dos scopes independientes, incluidos escritura sola y el orden inverso. Rechaza scopes desconocidos, duplicados o vacíos. El scope solicitado queda asociado al nonce/PKCE del consentimiento: enviar `write=yes` en un formulario solicitado solo para lectura no puede elevarlo. La pantalla solo describe permisos solicitados; no ofrece checkbox de escritura en la variante de lectura. En lectura + escritura se puede desmarcar escritura; en escritura sola no se concede lectura implícita.

Poppy ofrece las dos elecciones de uso anteriores, no un selector general de scopes personalizados. Rechaza una respuesta de token que conceda permisos fuera de lo solicitado. La renovación también solicita explícitamente los scopes actuales y rechaza una respuesta más amplia: expirar una Session no puede convertir lectura en escritura.

## Ampliar no es ejecutar

Cada consentimiento utiliza una Session candidata nueva. Hasta que termina correctamente se mantienen el acceso anterior, su conversación y sus propuestas. Un contador de consentimientos completados evita confundir un rechazo con éxito solo porque la cuenta anterior seguía conectada.

Tras éxito se sustituye el acceso activo y se conserva la conversación previa al primer acceso de cuenta (hasta 10 mensajes). El callback guarda esa parte pública y el polling de la UI restaura el historial devuelto por el servidor, en lugar de vaciarlo. En consentimientos posteriores solo se conserva esa parte pública: los turnos privados y las propuestas anteriores se eliminan porque la pantalla Company puede seleccionar otra cuenta. Sign out elimina también la copia pública. La interfaz pide volver a solicitar el cambio; no reproduce automáticamente el mensaje ni la compra. Cada operación conserva su aprobación humana separada.

Los tokens y grants anteriores no se amplían ni se revocan automáticamente. Revocar el grant antiguo corta sus tokens sin invalidar el nuevo. Los grants anteriores pueden gestionarse desde **Accesos** en Juniper; Sign out en Poppy revoca su grant activo, no todos los grants históricos. Los accesos de escritura guardados antes de esta entrega se mantienen: no hay migración silenciosa a lectura.

## Recuperación visible

| Situación                           | Comportamiento                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permiso insuficiente                | HTTP 403 y orientación para solicitar permisos; confirmación bloqueada localmente antes de enviar si falta escritura.                                                       |
| Acceso no aceptado                  | Se explica que pudo caducar o revocarse, sin inventar una causa exacta; se ofrece Sign in y se deshabilita la aprobación en la UI. Se conservan propuestas para inspección. |
| Propuesta caducada                  | HTTP 410 local al intentar aprobar; no se envía confirmación. Consultar estado y pedir otra propuesta si procede.                                                           |
| Términos cambiados                  | Consultar estado, revisar la nueva revisión y aprobarla por separado.                                                                                                       |
| Respuesta incierta                  | HTTP 502 y Check status antes de volver a confirmar o proponer. No hay reintento de compra.                                                                                 |
| Consentimiento rechazado/incompleto | No se interpreta el acceso anterior como un consentimiento nuevo ni se borra su contexto.                                                                                   |

Un 5xx con un código de error ambiguo no se presenta como revocación comprobada. No se muestran descripciones arbitrarias recibidas de la Company. Las restricciones de Retry-After siguen vigentes.

## Pruebas

Validación: 269 tests, TypeScript, lint, build y formato. El escenario permissions pasa 22 tests de Company y 47 de Poppy. Escaneo de 11 trazas de despliegue: cero referencias a archivos secretos.

```sh
pnpm scenarios permissions
```

- `consent-scopes.test.ts`: subconjuntos independientes y formulario manipulado sin ampliación.
- `authority-regression.test.ts`: lectura → propuesta bloqueada → nuevo consentimiento → propuesta → aprobación explícita; token antiguo inmutable y revocación independiente.
- Tests de rutas Poppy: petición predeterminada, ampliación explícita, rechazo de concesión excesiva, permisos insuficientes, caducidad, acceso no disponible y resultado incierto.
- `account-permissions.test.ts`: elección de scopes, validación del subconjunto, recuperación y detección de consentimiento completado.

Revisión visual en dos lotes escritorio/móvil. Juniper: páginas reales de consentimiento sin enviarlas. Poppy: estado de lectura y fallo de acceso inyectados con fixtures de navegador, sin emitir grants, consultar datos de cuentas ni llamar modelos. No se ha revalidado Sandbox en vivo. Revisión en el mismo hilo, sin revisor independiente.
