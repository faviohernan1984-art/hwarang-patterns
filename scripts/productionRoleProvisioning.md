# Provisioning productivo HTI: sala A

Preparado para una ejecución futura autorizada. Las pruebas offline no llaman a
Firebase cloud. Este comando no implementa login ni activa contraseñas.

Requiere explícitamente `--apply --project hwarang-patterns-production --room A`,
`PATTERNS_ADMIN_ENV=production` y `GOOGLE_APPLICATION_CREDENTIALS` apuntando a una
cuenta de servicio externa al repositorio y exclusiva de ese proyecto. Reutiliza
las restricciones de `productionAdmin`: sin fallback a sesión CLI, ADC o Emulator.
No cargar el `.env` local. Nunca poner una cuenta de servicio en variables `VITE_*`.

La sala debe existir con control configurado para tres jueces, meta y publicState,
un journal `_roomProvisioning/A` completo y una reserva `_presidentAssignments`
coincidente con el único Presidente activo. No se altera esa cuenta, sus claims,
contraseña, reserva ni journal. Tampoco se escribe en `rooms/**`: los resultados,
submissions y créditos actuales se conservan. Reservar institucionalmente A sigue
requiriendo confirmación administrativa; este comando no declara esa relación.

La entrada por stdin es un objeto JSON con exactamente estas claves:

```json
{
  "public": "publico@institucion.example",
  "judge/1": "juez1@institucion.example",
  "judge/2": "juez2@institucion.example",
  "judge/3": "juez3@institucion.example"
}
```

Es un ejemplo ficticio. Mantener el manifiesto real fuera del repositorio y
entregarlo por una entrada privada o archivo protegido mediante stdin. El comando
no recibe ni guarda contraseñas, no imprime emails, UIDs, claims, valores del
manifiesto, rutas de credenciales ni errores SDK. Solo devuelve conteos de roles,
usuarios creados y asignaciones efectuadas, o una etiqueta fija de fallo.

Comando futuro (requiere el JSON en stdin):

```text
npm run provision:roles:production -- --apply --project hwarang-patterns-production --room A
```

Antes de cualquier mutación, se validan todos los destinatarios y se recorren
todas las páginas de Auth para detectar ocupantes duplicados, asignaciones
malformadas o deshabilitadas de la sala. Los cuatro emails normalizados deben ser
distintos. Una cuenta existente solo se reutiliza con exactamente los claims del
rol solicitado; una cuenta ajena sin claims no se adopta. Se rechaza cualquier
conflicto con reservas anteriores de rol o Presidente.

Una transacción reserva las cuatro plazas en `_roomRoleProvisioning/A` y los UIDs
en `_roleAssignments/HASH_UID`. Guarda hashes de emails, no emails en claro.
Los usuarios nuevos tienen UIDs deterministas y un marcador de procedencia.
Los claims se asignan después de las reservas, revalidando propiedad y duplicados.
Los jueces reciben `judgeId` numérico 1, 2 y 3; Público no recibe `judgeId`.

Una interrupción deja el plan `pending`. Repetir exactamente el mismo manifiesto
reanuda el trabajo, incluso si se perdió una respuesta de creación o claims.
Solo se recupera una cuenta sin claims si pertenece al plan pendiente y coincide
con UID, email y marcador del flujo. Cambiar destinatarios, adoptar una cuenta
ajena o recrear una cuenta eliminada de un plan completo provoca un fallo.
Una repetición compatible ya completa no escribe nada ni cambia contraseñas.

Auth y Firestore no comparten transacción. Puede quedar un subconjunto de roles
asignado antes de un fallo; no se revierte ni elimina automáticamente. Las reservas
coordinan ejecuciones de esta herramienta, pero otros operadores Admin deben
serializar sus cambios. Ninguna herramienta puede impedir que un Admin externo
asigne claims al margen de las reservas. No usar varios manifiestos simultáneos.

Después del provisioning, todavía debe prepararse activación privada de
contraseñas. El inicializador de contraseña actual es exclusivo de Presidente:
no utilizarlo para Público o jueces. El login multirol está implementado localmente
en `src/productionRoleSession.js`; debe publicarse mediante un despliegue autorizado
antes de usarlo en cloud. La versión publicada `befcfa5` solo admite Presidente.
No iniciar una nueva evaluación de A hasta preservar su resultado anterior.

Validación offline:

```text
npm run test:roles:production
node --test scripts/productionProvisioning.test.js scripts/productionPresidentPassword.test.js
```
