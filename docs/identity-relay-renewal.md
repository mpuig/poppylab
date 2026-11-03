# Renovación del relay de identidad — 20 octubre 2026

El operador autorizó renovar el túnel después de comprobar que su hostname anterior no resolvía. Se detuvieron únicamente los procesos antiguos del relay/túnel cuya identidad y PIDs propios se verificaron, no los servicios de Poppy o Juniper.

## Cambios

- Nuevo Cloudflare quick tunnel dirigido exclusivamente a `127.0.0.1:4101`.
- Relay reiniciado con el callback permitido para el issuer exacto `https://api.ample.computer/poppy`, además de los tres issuers Sandbox existentes. El origen sin `/poppy`, paths distintos y dominios similares se rechazan.
- Actualizado únicamente `AGENT_PUBLIC_ORIGIN` en `.env.local` ignorado. Un fingerprint del resto del archivo confirmó que modelos, claves y demás valores no cambiaron. Next recogió el cambio sin terminar su proceso.
- La clave de firma no cambió: JWKS público antes/después idéntico.
- El supervisor temporal consume la salida de cloudflared y guarda solo la URL pública asignada y estado de salida, no URLs de peticiones ni valores de callback.

Estado operativo temporal:

- `/tmp/poppy-identity-relay.pid`
- `/tmp/poppy-identity-tunnel.pid`
- `/tmp/poppy-identity-tunnel-wrapper.pid`
- `/tmp/poppy-identity-tunnel-url.txt`
- `/tmp/poppy-identity-relay.log`
- `/tmp/poppy-identity-tunnel-events.log`

Estos archivos describen procesos de esta sesión; verifica siempre PIDs y comandos antes de detenerlos. El túnel es temporal, no un despliegue de producción.

## Comprobaciones públicas reales

Todas usando HTTPS con validación de certificado; no se desactivó TLS:

| Petición pública                              | Resultado                                                     |
| --------------------------------------------- | ------------------------------------------------------------- |
| GET `/agent/client.json`                      | 200; client_id, JWKS y callback coinciden con el nuevo origen |
| GET `/agent/jwks.json`                        | 200; misma clave pública, sin `d`                             |
| GET `/`, `/api/chat`, `/api/account`          | 404                                                           |
| GET `/.env.local`, `/.poppy/identity.json`    | 404                                                           |
| GET metadata con parámetros de proxy          | 404                                                           |
| POST `/agent/client.json`                     | 405                                                           |
| Callback Ample con state/código sintéticos    | 302 al localhost fijo; no se siguió                           |
| Callback con origen Ample sin issuer `/poppy` | 400                                                           |

El callback sintético no correspondía a ningún consentimiento ni se intercambió por tokens. No hubo llamadas a herramientas ni a cuentas de Ample.

La comprobación inicial con urllib falló por el almacén de certificados local de Python; se completó con curl y su verificación TLS habitual, sin usar `-k` ni equivalentes.

## Qué hacer ahora

1. Recarga `http://localhost:3000`.
2. Introduce `https://ample.computer` y pulsa **Connect** de nuevo, aunque ya aparezca conectado: hace falta un run nuevo con la nueva identidad.
3. Pulsa **Sign in to Ample Computer · read only** y completa tú el consentimiento en Ample.
4. Vuelve a Poppy y solicita una lectura. Mantén el relay y el túnel en ejecución.

El cambio de origen cambia el `client_id`. Los grants guardados de la identidad anterior no se han modificado, revocado ni migrado. Como la URL anterior ya no resolvía, puede ser necesario gestionar su revocación desde la Company correspondiente; no se intentó reutilizarlos bajo la nueva identidad.

Los 10 tests del relay cubren superficie pública, claves privadas rechazadas, callback de Sandbox y Ample, redirect fijo e issuers incorrectos. Suite completa actual: 322 tests. Ninguna de estas pruebas sustituye la autorización humana ni demuestra lecturas privadas exitosas en Ample.
