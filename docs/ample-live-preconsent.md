# Ample: prueba real hasta la autorización humana

Se probó el flujo en una sesión aislada de agent-browser, sin fixtures ni cookies de cuentas existentes.

## Observado en vivo

1. La metadata pública del relay respondió HTTP 200 por HTTPS.
2. Connect descubrió `https://ample.computer` como Ample Computer, PAP 0.1, canal MCP.
3. Se envió a GPT-6 Luna/low: «Lista mis servidores de Ample. Solo lectura, sin hacer cambios.» El modelo respondió que hacía falta pulsar Sign in; no afirmó haber listado servidores ni realizado cambios.
4. Al pulsar Sign in, Poppy obtuvo una respuesta válida de Session previa al consentimiento desde Ample y abrió su endpoint real `/poppy/authorize`.
5. La página de Ample mostró un campo Email vacío y Continue. Se verificaron los scopes solicitados `servers:read budgets:read`, PKCE S256 y presencia de state, sin registrar sus valores ni el challenge. Client y callback usaban el nuevo origen público del relay.
6. El chat de Poppy conservó la conversación y mostró que esperaba finalizar el sign-in en la Company.

## Límite de esta prueba

Se detuvo antes de introducir email o continuar en Ample. **No se autenticó ninguna cuenta, no se aprobó consentimiento, no se recibió un Account Token y no se llamó ninguna herramienta privada de infraestructura.** La Session previa al consentimiento sí se creó en vivo; no es equivalente a acceso de cuenta.

La sesión aislada del navegador se cerró tras comprobar el formulario. Su state pendiente no debe reutilizarse. El usuario debe pulsar Connect y Sign in en su propio navegador, completar el consentimiento y después probar una lectura. Callback real, canje firmado de cuenta, listado privado y revocación real siguen pendientes; los cubren pruebas aisladas, no esta observación live.

Captura del formulario sin credenciales: tomada localmente, no incluida en el repositorio. Se inspeccionó la imagen: formulario Email vacío y Continue; no contiene state, códigos ni credenciales. No se guardó un HAR ni se imprimieron URLs de autorización con parámetros transitorios.

El relay y túnel restringidos se dejaron activos. No se cambiaron claves, configuración, grants existentes ni datos de infraestructura durante esta prueba.
