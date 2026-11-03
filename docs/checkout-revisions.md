# Revisar checkout y continuar desde otra Session

Juniper admite renegociación de **checkout pendiente**. No es una revisión genérica de todas las propuestas: perfil, soporte, carrito y recurrencia conservan sus flujos anteriores.

## Contrato

`POST /api/account/checkout-revision`, publicado como tool `revise_checkout_proposal`:

```json
{
  "operation_id": "op_identificador",
  "revision": 1,
  "day": "Saturday"
}
```

Exige un token firmado/DPoP válido, cuenta, scope de escritura y soporte Operations v1. El contrato de herramientas exige read y write. Solo admite esos tres campos; nunca acepta precios, destino, aprobación ni terms proporcionados por el agente.

- Identifica al propietario por cliente, User ID y cuenta, no por Session.
- Exige checkout propuesto, no caducado y revisión vigente. Una revisión antigua devuelve 409 `terms_changed`; otro propietario recibe 404.
- Recalcula todos los términos con el **carrito y perfil actuales**: artículos, cantidades, importe, dirección, destinatario y versiones. El día solicitado se incluye en summary y terms.
- Devuelve la misma Operation con revisión incrementada, nueva caducidad de cinco minutos, confirmación nula y aprobación humana requerida. No modifica carrito, perfil ni pedidos.
- Conserva un snapshot inmutable de la revisión anterior en el vault. Máximo veinte cambios por Operation; el límite devuelve 429. El historial es interno, no un endpoint público nuevo.
- Una petición que no cambia términos devuelve la revisión actual sin ampliar caducidad. Repetir una petición con revisión antigua no genera otra revisión; exige consultar estado.
- Revisiones concurrentes usan compare-and-swap: como máximo una petición que parte de la misma revisión puede crear la siguiente.

Una aprobación de revisión 1 no autoriza revisión 2. Confirmar 1 devuelve `terms_changed`. Consultar estado muestra 2, y Poppy requiere otra acción humana explícita. Confirmar 2 dos veces devuelve el mismo resultado y mantiene un solo pedido.

## Continuación de Session

Cuando una renovación recibe exactamente HTTP 400 `invalid_session`, Poppy puede renovar una vez más **con el mismo Account Token y sin session_id**, con assertions y prueba nuevas. Tras validar la respuesta sustituye la Session y conserva conversación y propuestas pendientes, porque sigue siendo la misma cuenta/grant. No hace esta recuperación ante `account_mismatch`, `invalid_grant`, HTTP 5xx o fallo de red incierto. No repite una compra como consecuencia de ello.

Juniper acepta leer, revisar y confirmar la Operation desde la nueva Session de ese propietario. Otra cuenta, cliente o User ID no puede hacerlo. La caducidad de la Operation sigue vigente; una Session nueva no la revive. Poppy mantiene también el límite de duración de sus runs: esta recuperación no reabre runs caducados ni elimina la limpieza de contexto al cambiar de cuenta mediante consentimiento.

## Evidencia aislada

```sh
pnpm scenarios revisions
```

- `apps/example-company/src/revisions.test.ts`: inmutabilidad, nuevo cálculo, campos no permitidos, estado/caducidad, límites, concurrencia y propiedad.
- `apps/example-company/src/authority-regression.test.ts`: crea checkout en el último minuto de una Session, deja caducar esa Session, obtiene otra con el Account Token, rechaza Maya y read-only, crea revisión 2, rechaza aprobación antigua, reinicia desde un vault real temporal y confirma una sola vez.
- `apps/playground/app/api/account/juniper-revision.test.ts`: herramientas OpenAPI generadas → handlers reales Juniper → ruta de aprobación Poppy → un pedido. Inyecta una Session autenticada y un transporte Fastify en memoria; no simula respuestas de negocio. La criptografía y persistencia se prueban en el caso anterior.
- `apps/playground/lib/runtime.test.ts`: recuperación de Session acotada sin perder contexto y sin reintentar errores inciertos.

No se ejecuta un modelo ni se usa el navegador live en estas pruebas. No se modifican cuentas guardadas ni se confirman operaciones de Sandbox. Fastify se añade como dependencia **de desarrollo** del playground para la prueba entre aplicaciones. Revisión en el mismo hilo, sin revisor independiente.
