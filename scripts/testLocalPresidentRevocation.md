# Comprobación local de revocación de Presidente

El script requiere una sala DEMO existente y credenciales vigentes de Presidente,
Público y cada juez configurado. No crea salas, migra versiones ni reprovisiona.
Por defecto realiza solo el preflight; `--execute` habilita una revocación real.

Usar los emuladores ya iniciados con las reglas actuales, sin actividad deportiva,
escrituras pendientes ni otros operadores durante la comprobación. Cerrar las
pantallas deportivas evita que efectos de la aplicación consuman créditos o
actualicen puntuaciones en paralelo. El script abre sus propias sesiones Auth
en memoria y conserva la misma sesión del Presidente antes y después.

Configurar en PowerShell:

```powershell
$env:PATTERNS_DEV_PRESIDENT = 'true'
$env:GCLOUD_PROJECT = 'demo-patterns-gups'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
```

Entregar por stdin un objeto JSON cuyas claves sean exactamente `president`,
`public`, `judge/1` … `judge/3` o `judge/5`, con las credenciales de la sala.
Usar entrada privada o una fuente local protegida; no escribir secretos como
literales de comandos, argumentos, archivos del repositorio ni logs.

Comando de preflight (reemplazar el identificador completo; requiere stdin):

```powershell
node scripts/testLocalPresidentRevocation.js --room demo-patterns-REEMPLAZAR_POR_24_HEX
```

Solo para una ejecución posterior expresamente autorizada, añadir `--execute`
al mismo comando. No repetirlo: Presidente queda inactivo tras la primera
revocación y el preflight rechazará ese estado. No hay restauración automática.

El preflight verifica entorno loopback y proyecto, existencia de sala, versiones
y grants activos, journal e identidades mediante el lector existente, claims de
cada sesión y lecturas de servidor. Un token de Presidente con versión incorrecta
debe fallar antes de revocar; Público y jueces deben carecer de escritura sobre
control. Estas pruebas negativas no cambian datos deportivos: usan el mismo
valor de `pausedRemaining` como payload.

En ejecución, una transacción vuelve a comparar documentos conocidos, journal y
autorización con la línea de base antes de revocar exclusivamente `president`.
Luego comprueba lecturas y escritura denegadas con la sesión aún autenticada,
rechazo de nueva emisión de token con la credencial anterior y lecturas permitidas
para los demás roles. Compara recursivamente todos los documentos bajo la sala,
incluidos créditos, y verifica journal y asignaciones Auth. Los tiempos de último
login de Auth se excluyen porque iniciar las sesiones los actualiza legítimamente.

Cualquier inconsistencia termina con código 1 y una etiqueta fija, sin detalles
de SDK, credenciales ni snapshots. Un fallo posterior a la revocación deja al
Presidente revocado; no intenta corregir ni revertir el estado. La comparación
final detecta documentos nuevos o eliminados; la transacción no impide que otro
proceso cree documentos desconocidos. Por eso se requiere una sala sin actividad
concurrente. No se prueban escrituras deportivas exitosas de otros roles.

Validación sin emuladores ni revocación real:

```powershell
node --test scripts/testLocalPresidentRevocation.test.js scripts/localDemoAuthorization.test.js
npx.cmd --no-install eslint scripts/testLocalPresidentRevocation.js scripts/testLocalPresidentRevocation.test.js
```
