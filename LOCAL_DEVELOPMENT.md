# Patterns: entorno local (microetapa 1)

Esta etapa solo permite development, proyecto demo-patterns-gups y Auth + Firestore Emulator. Sin emuladores disponibles las operaciones fallan; no hay fallback cloud. La configuración se valida antes de inicializar Firebase. No hay login automático, provisioning, JOIN ni credenciales: una Room sin identidad conserva AUTH_REQUIRED.

Requisitos: Node compatible con Vite 8, Java 21 y Firebase CLI (firebase-tools). Instalar CLI si falta: npm install -g firebase-tools.

Desde este repositorio, en dos terminales:

    npm run emulators
    npm run dev

Pruebas y build:

    npm test
    npm run test:emulators
    npm run build

.env contiene valores demo públicos, compartidos también por los tests Node. Copiar .env.example a .env.local solo para overrides locales; no versionar .env.local. Las pruebas Node usan .env y no overrides Vite.

## LAN controlada

Usar una red privada confiable. En .env.local definir VITE_FIREBASE_ALLOW_LAN=true y VITE_FIREBASE_EMULATOR_HOST=IP_PRIVADA_DEL_PC (por ejemplo 192.168.1.20). Ambos puertos deben coincidir con firebase.lan.json. Reiniciar Vite al cambiar variables.

    firebase emulators:start --config firebase.lan.json --only auth,firestore --project demo-patterns-gups
    npm run dev -- --host 0.0.0.0

En el móvil abrir http://IP_PRIVADA_DEL_PC:5173. Permitir puertos 5173, 8080 y 9099 en firewall solo desde los dispositivos/red privada autorizados. Sin port forwarding, túneles ni exposición pública. UI de emuladores queda en loopback. Los emuladores no implementan un perímetro de acceso: terminar procesos al finalizar. Datos locales efímeros, separados de producción. No desplegar el build de esta etapa: usa endpoints locales y no habilita producción.


## Microetapa 2: provisioning y President DEV (solo PC local)

Admin corre solo en Node, sin service account ni credenciales cloud; deshabilita la deteccion de metadata cloud. Requiere Node 22 o superior (validado en Node 24), opt-in, proyecto demo exacto y ambos endpoints loopback explicitos. El script crea Room A y el usuario dev-president-room-A con roomId=A, role=president. Repetirlo conserva documentos existentes; una Room parcial falla sin resetear datos. No crea Judges ni JOIN.

Terminal 1, desde el repositorio:

    npx.cmd --yes --package firebase-tools firebase emulators:start --only auth,firestore --project demo-patterns-gups

Terminal 2 (PowerShell):

    $env:PATTERNS_DEV_PRESIDENT="true"
    $env:GCLOUD_PROJECT="demo-patterns-gups"
    $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
    $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
    $env:VITE_FIREBASE_EMULATOR_HOST="127.0.0.1"
    $env:VITE_FIREBASE_ALLOW_LAN="false"
    npm.cmd run provision:local
    npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort

Si ya están activos los emuladores LAN de microetapa 1, conservarlos y usar sus endpoints loopback en terminal 2. Detener únicamente el Vite anterior antes de reiniciarlo con opt-in DEV.

Abrir http://localhost:5173/__dev/president en la PC y pulsar Entrar como President DEV. Se intercambia un custom token efímero con Auth Emulator y se redirige a /rooms/A/president. La sesión persiste en ese origen. /rooms/B/president queda ROOM_FORBIDDEN; /rooms/A/public queda ROLE_FORBIDDEN. Sin sesión, la URL operativa conserva AUTH_REQUIRED y no provisiona nada.

La entrada DEV no funciona desde LAN, no acepta parámetros de Room/rol/UID ni orígenes externos, no imprime tokens, solo existe con opt-in en Vite dev y no forma parte del build. No agregar credenciales productivas. Para salir, borrar los datos del sitio localhost:5173 en el navegador. Al reiniciar emuladores sin export/import, repetir provisioning.

Para las pruebas de integracion usar emuladores desechables, pues los tests de reglas inicializan Room A/B. Ejecutar npm run test:emulators para las reglas. Para integracion President usar PATTERNS_DEV_PRESIDENT=true, PATTERNS_TEST_PRESIDENT=true, GCLOUD_PROJECT=demo-patterns-gups y ambos endpoints explicitos, y ejecutar npm run test:president sobre esos emuladores desechables. Ejecutar ambas suites secuencialmente. No ejecutar esta suite sobre una sesion manual en uso.


## Microetapa 3: Public y Judges DEV

El mismo npm run provision:local crea las cinco identidades fijas de Room A (President, Public, Judges 1-3), sin resetear documentos existentes. Se conserva el opt-in PATTERNS_DEV_PRESIDENT=true y los comandos de microetapa 2. No existe JOIN, aprobacion ni provision desde URL.

Abrir en pestanas independientes, usando siempre localhost:5173:

- http://localhost:5173/__dev/president
- http://localhost:5173/__dev/public
- http://localhost:5173/__dev/judge/1
- http://localhost:5173/__dev/judge/2
- http://localhost:5173/__dev/judge/3

Pulsar Entrar en cada pestana: la sesion usa browserSessionPersistence (por pestana) y redirige a su URL operativa. Iniciar cada identidad en una pestana nueva, sin duplicar la pestana de otra identidad. Para cambiar de rol usar su entrada DEV. No abrir la URL operativa directamente esperando un login automatico. Cerrar la pestana termina su sesion DEV.

Prueba manual minima: enviar votos desde Judges 1-3 y observar President/Public. Desde Public abrir /rooms/A/president (ROLE_FORBIDDEN). Desde Judge 1 abrir /rooms/A/judge/2 (JUDGE_FORBIDDEN). Desde cualquier identidad abrir /rooms/B con su rol (ROOM_FORBIDDEN). Acceso DEV solo en la PC por loopback; para sesiones anteriores a esta etapa volver a entrar desde su entrada DEV.

Pruebas especificas: npm run test:roles. Integracion: PATTERNS_TEST_ROLES=true, opt-in y endpoints Admin explicitos contra emuladores desechables. No ejecutarla sobre una evaluacion manual en uso porque escribe submissions de prueba.


### Realtime con cinco identidades DEV en el mismo navegador

Solo en Vite dev, con pagina y emulador en loopback, Firestore usa un alias .localhost fijo por rol: patterns-president.localhost, patterns-public.localhost y patterns-judge-1/2/3.localhost (por ejemplo patterns-judge-1.localhost). Todos apuntan al mismo emulador y puerto. Se evitan colas HTTP/1.1 entre las conexiones Listen y Write de las cinco pestanas; no se comparten tokens ni privilegios. Auth sigue usando el endpoint configurado. En LAN, Node y build se conserva el host configurado.

Tras aplicar este cambio cerrar las cinco pestanas anteriores y reabrir sus entradas DEV. No hace falta volver a provisionar ni borrar la Room. Validar START/PAUSE y SEND sin refrescar. No mantener pestanas antiguas conectadas al transporte anterior.

## Microetapa 4.1: Room y President parametrizados (solo Emulator)

Con el opt-in y endpoints Admin loopback de microetapa 2:

    npm.cmd run provision:president -- --room B --email president-b@patterns.test

Crea/reutiliza una cuenta Auth sin password ni tokens de acceso y asigna claims President solo despues de provisionar los tres documentos. No habilita login ni acceso DEV para B. El comando provision:local conserva Room A y sus cinco identidades DEV.

Los registros privados _localPresidentAssignments y _localRoomProvisioning reservan UID/Room y permiten reintentos sin resetear evaluaciones. Las Rules actuales niegan acceso cliente a esos registros. No borrar reservas para forzar reasignaciones. Una Room parcial sin registro, una parcial con documentos ya modificados o una Room completa sin propietario verificable se rechazan. Auth/Firestore no comparten transaccion: ante fallos pueden quedar una cuenta sin claims o una reserva pendiente; repetir exactamente el mismo comando. No hay rollback destructivo ni reasignacion automatica. Ejecutar tests de provisioning solo en emuladores desechables.
