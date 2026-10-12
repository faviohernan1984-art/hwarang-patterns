# Login productivo por claims

En producción, `/login` usa Firebase Auth con email y contraseña para Presidente,
Público y jueces 1–3. No hay selector de sala, rol ni juez. Después del login se
solicita un ID token fresco a Firebase Auth y se deriva el destino de sus claims:

| Claims | Destino |
| --- | --- |
| `roomId`, `role: president` | `/rooms/{roomId}/president` |
| `roomId`, `role: public` | `/rooms/{roomId}/public` |
| `roomId`, `role: judge`, `judgeId: 1..3` numérico | `/rooms/{roomId}/judge/{judgeId}` |

El proyecto/app debe coincidir con el contrato productivo aprobado, sin Emulator.
Se rechazan salas inválidas, claims adicionales ajenos al contrato, asignaciones
legacy o DEMO y `judgeId` presente en Presidente/Público. Los campos estándar de
Firebase Auth están admitidos. Los claims nunca se obtienen de query strings,
formularios de rol, localStorage ni tokens aportados manualmente.

Un login nuevo cierra la sesión anterior. Los errores de entorno, persistencia,
autenticación, obtención de token o claims intentan cerrar la sesión y no devuelven
un destino. El formulario borra la contraseña y muestra un mensaje genérico sin
datos de Firebase. Se mantiene la persistencia de sesión del login anterior.

El login de Presidente conserva su destino y restricciones. En development el
formulario sigue llamando al flujo original `loginPresident`; el circuito DEMO,
sus credenciales y sus emisores no se modifican. `/logout` conserva el cierre de
sesión existente. Las reglas Firestore siguen siendo la autoridad sobre datos.

Este cambio no crea usuarios, asigna claims ni activa contraseñas. Las cuatro
cuentas nuevas del provisioning multirol necesitan activación privada antes de
entrar. La versión ya publicada sigue sin cambios hasta un despliegue autorizado.

Pruebas offline:

```text
npm run test:login:production
```
