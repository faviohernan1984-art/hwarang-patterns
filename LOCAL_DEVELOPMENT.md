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
