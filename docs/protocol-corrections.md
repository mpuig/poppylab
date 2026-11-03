# Correcciones PAP: Session, negociación y recuperación

Referencia: borrador PAP 0.2 §§3.3, 4.2–4.4, 4.8–4.9, 6 y Operations v1 §2, mismas copias de referencia de la [matriz](pap-coverage.md). No constituye certificación completa ni revalidación live de Sandbox.

## Una cuenta por Session — A08

Juniper rechaza `account_mismatch` antes de emitir tokens o cambiar una Session previamente asociada a otra cuenta. Aplica tanto a exchange como a refresh. La renovación signed-out conserva la asociación; revocar no la elimina. Los tokens antiguos conservan su propia cuenta, scopes y grant.

Poppy prepara una Session candidata sin credenciales de la anterior. La mantiene en el estado OAuth transitorio, ligado a state/cookie/issuer/PKCE. Solo un callback válido sustituye Session/DPoP/User ID, tokens, historial y aprobaciones. Un error conserva el acceso y contexto anteriores. Un `account_mismatch` explica que hay que volver a Sign in para una Session nueva; no hay reintento automático ni bucle de consentimiento. El polling no interpreta el acceso anterior como éxito mientras hay consentimiento pendiente.

La asociación histórica conocida se conserva; no se puede reconstruir retroactivamente el historial de Sessions que cambiaron de cuenta antes de esta corrección. No se borran compras, casos ni perfiles.

## Operations y errores — D05/A15

La capacidad `extensions.operations.version === "1"` se obtiene de la metadata autenticada del cliente y queda fijada al token. Sin ella, propuestas, confirmaciones/cancelaciones y lectura de Operations fallan con HTTP 403 `extension_required`, incluido el nombre `operations` en JSON y challenge. Las lecturas de negocio no necesitan esa extensión. Tokens legacy sin evidencia de capacidad fallan cerrados hasta su renovación; no se inventa retroactivamente un anuncio.

El token endpoint distingue `invalid_client`, `invalid_dpop_proof`, `invalid_session`, `invalid_scope`, `account_mismatch` y `rate_limited`. Un `resource` no soportado se rechaza como `invalid_target`, no se ignora. En APIs, primero se valida el token y su prueba; errores de cuenta, scope y extensión llevan `WWW-Authenticate`, incluyendo el scope requerido. Las pruebas inválidas ya no se etiquetan como token inválido.

El cliente conserva status HTTP, código de una lista permitida y plazo de espera mediante `ProtocolError`; nunca muestra descripciones arbitrarias, cuerpos remotos, tokens ni challenges completos. Los errores de canales ausentes siguen fuera del perfil implementado. El ciclo `use_dpop_nonce` se incorporó posteriormente: véase [nonces y escenarios](scenario-lab.md). No se afirma cobertura de todo OAuth.

## Retry-After — A14

Las respuestas 429 de Juniper incorporan `Retry-After`. El transporte entiende segundos y fecha HTTP, comparte cooldown por origen y bloquea peticiones antes de abrir conexión hasta el plazo indicado. No duerme una petición del modelo ni repite un POST automáticamente. Un plazo posterior nunca se acorta por otro más breve. La tabla está acotada; al saturarse, un plazo global conservador evita eludir la espera mediante otros orígenes.

Poppy configura un store cifrado `retry-after.enc`; el plazo se guarda al recibir la respuesta y se restaura al arrancar. Un test usa el vault real y una carga nueva del módulo para comprobarlo. La ruta humana devuelve HTTP 429, Retry-After y una explicación de espera. La librería sin un store configurado conserva cooldown solo durante el proceso. No hay coordinación distribuida: se mantiene la restricción single-writer del proyecto.

## Respuesta perdida tras commit — O07

Una regresión crea checkout con autorización y DPoP, envía confirmación por un socket HTTP real y destruye la respuesta **después del guardado**. Se cierra el servidor, se reconstruye desde el vault cifrado real en un directorio temporal y se consulta el estado: `succeeded`, exactamente un pedido. Reconfirmar la misma operación/revisión devuelve el mismo resultado y no crea otro pedido.

Una segunda prueba en la ruta de Poppy simula respuesta incierta: solo una llamada a confirmación, operación retenida, y recuperación posterior mediante GET de estado. Un fallo incierto devuelve 502 con instrucción de consultar estado, no de proponer otra compra. Son garantías locales con un writer, no exactly-once distribuido.

## Evidencia y límites

- [Autoridad, negociación, errores, rate limit y corte de socket](../apps/example-company/src/authority-regression.test.ts).
- [Consentimiento candidato y recuperación humana](../apps/playground/app/api/account/route.test.ts).
- [Callback y mismatch](../apps/playground/app/api/account/callback/route.test.ts).
- [Errores/cooldown de transporte](../packages/pap-client/src/protocol-error.test.ts).
- [Cooldown cifrado y reinicio](../packages/pap-client/src/retry-persistence.test.ts).

Validación de esta entrega inicial: **199 tests** pasaron, junto con TypeScript, lint, build de producción y formato. Escaneo de 11 trazas de despliegue: cero referencias a archivos de secretos. Enlaces locales de la matriz y este informe comprobados.

Las pruebas son aisladas: no confirman ni cancelan operaciones de Sandbox, no resetean las personas existentes y no cambian el modelo configurado. Revisión realizada en el mismo hilo; no hubo revisor independiente. No se amplían scopes, canales ni autoridad del modelo.
