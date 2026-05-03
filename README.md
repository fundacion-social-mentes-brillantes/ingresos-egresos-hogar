# Ingresos y Egresos Hogar 🏠💸

Aplicación web profesional para el control financiero personal/familiar, potenciada por inteligencia artificial.

## Características
- **Asistente Inteligente**: Registra gastos e ingresos usando lenguaje natural (Ej: "Me gasté 10k en un helado").
- **Dashboard Moderno**: Visualiza tu balance mensual, gastos por categoría y movimientos recientes.
- **Seguridad Robusta**: Autenticación con Firebase y reglas de Firestore para total privacidad de datos.
- **Responsive**: Optimizado para dispositivos móviles y escritorio.
- **Tecnología de Punta**: React, TypeScript, Tailwind CSS v4, Firebase Functions v2 y DeepSeek API.

## Requisitos Previos
- Node.js (v20 o superior recomendado).
- Cuenta en [Firebase Console](https://console.firebase.google.com/).
- API Key de [DeepSeek](https://platform.deepseek.com/).

## Configuración del Proyecto

### 1. Clonar e Instalar
```bash
npm install
cd functions
npm install
cd ..
```

### 2. Configurar Firebase en el Frontend
Crea un archivo `.env` en la raíz del proyecto (no en functions) con tus credenciales de Firebase:
```env
VITE_FIREBASE_API_KEY=tu_api_key
VITE_FIREBASE_AUTH_DOMAIN=tu_proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu_proyecto
VITE_FIREBASE_STORAGE_BUCKET=tu_proyecto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=tu_sender_id
VITE_FIREBASE_APP_ID=tu_app_id
```

### 3. Configurar Secreto de DeepSeek
Para que las Firebase Functions puedan llamar a la IA, debes configurar la API Key como un secreto:
```bash
firebase functions:secrets:set DEEPSEEK_API_KEY
```
*(Ingresa tu clave cuando el CLI la solicite)*

### 4. Desplegar
```bash
# Desplegar reglas de Firestore e índices
firebase deploy --only firestore

# Desplegar Functions
firebase deploy --only functions

# Construir y desplegar Hosting
npm run build
firebase deploy --only hosting
```

## Desarrollo Local
Para correr el frontend localmente:
```bash
npm run dev
```

Para probar las funciones localmente usando el emulador:
```bash
cd functions
npm run serve
```

## Arquitectura de Seguridad
- Los datos de cada usuario están aislados bajo `users/{uid}`.
- Las reglas de Firestore impiden que cualquier usuario acceda a datos de otros.
- La lógica de IA (DeepSeek) se ejecuta exclusivamente en el backend (Firebase Functions) para proteger la API Key.

---
Creado con ❤️ para el control financiero familiar.
