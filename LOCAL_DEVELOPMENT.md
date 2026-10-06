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
