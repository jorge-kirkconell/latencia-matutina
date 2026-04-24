# Latencia Matutina v1.0

Sistema interno de control de puntualidad SLA — Departamento TI.

🌐 **Demo en vivo:** `https://jorge-kirkconell.github.io/latencia-matutina/`

## Estructura del Proyecto

```
latencia-matutina/
├── index.html          ← Landing page raíz (GitHub Pages)
├── .nojekyll           ← Necesario para GitHub Pages
├── dashboard/          ← Consola admin (desktop/tablet)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── pwa/                ← App móvil "Llegué" (celular)
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── manifest.json
│   └── sw.js
├── data/               ← Base de datos JSON
│   ├── team.json
│   ├── records.json
│   └── payments.json
├── worker/             ← Cloudflare Worker (proxy de escritura)
│   └── index.js
└── README.md
```

## Modo Demo (sin configuración)

Funciona inmediatamente con datos en **localStorage** del navegador.
No necesita GitHub ni Cloudflare para probarlo.

**Tokens de demo:**
| Token | Nombre | Rol |
|-------|--------|-----|
| TK-ADMIN-0000 | Administrador | Admin |
| TK-JP-1234 | Juan Pérez | Colaborador |
| TK-ML-5678 | María López | Colaborador |
| TK-CR-9012 | Carlos Rodríguez | Colaborador |

---

## Deploy en GitHub Pages (producción)

### Paso 1 — Crear el repositorio en GitHub

```bash
# En la carpeta del proyecto:
git init
git add .
git commit -m "feat: v1.0 — Sistema Latencia Matutina"
git branch -M main
git remote add origin https://github.com/jorge-kirkconell/latencia-matutina.git
git push -u origin main
```

> ⚠️ El repo debe ser **público** para usar GitHub Pages gratis.

### Paso 2 — Habilitar GitHub Pages

1. Ve al repositorio en GitHub → **Settings → Pages**
2. Source: **Deploy from branch**
3. Branch: `main` / folder: `/ (root)`
4. Espera 1-2 minutos → tu app estará en:
   `https://jorge-kirkconell.github.io/latencia-matutina/`

### Paso 3 — Crear el Cloudflare Worker (escritura de datos)

1. Ve a [workers.cloudflare.com](https://workers.cloudflare.com) → cuenta gratuita
2. **Create a Worker** → pega el contenido de `worker/index.js`
3. Ve a **Settings → Variables** y agrega:
   - `GITHUB_TOKEN` — Personal Access Token (Settings → Developer settings → PAT → `contents:write`)
   - `GITHUB_OWNER` — `jorge-kirkconell`
   - `GITHUB_REPO`  — `latencia-matutina`
   - `GITHUB_BRANCH` — `main`
4. Deploy → copia la URL del worker (ej: `https://latencia.jorge-kirkconell.workers.dev`)

### Paso 4 — Configurar la app

1. Abre el **Dashboard** → Tab **Admin**
2. Pega la Worker URL → **Guardar configuración**
3. ¡Listo! Los datos ahora persisten en GitHub

---

## Registro de llegada — desde web Y desde móvil

A partir de v1.0 puedes registrar tu llegada desde **cualquier dispositivo**:

| Método | Cómo acceder |
|--------|-------------|
| **Dashboard Web** | `…/dashboard/` → Tab "Hoy" → Widget de registro visible si no has registrado |
| **App PWA (móvil)** | `…/pwa/` → instala en pantalla de inicio |

Ambos métodos generan el mismo tipo de registro (idénticos campos, mismo motor de castigos).

---

## Uso

### Para cada colaborador
1. Abre `https://jorge-kirkconell.github.io/latencia-matutina/`
2. Selecciona **App "Llegué"** (móvil) o **Dashboard** (desktop)
3. Ingresa tu token personal
4. En el Tab **Hoy** → registra tu hora de llegada con tiempo real, preview de castigo y toggle de Fuerza Mayor

### Para el administrador (Dashboard)
1. Ingresa con token `TK-ADMIN-0000`
2. **Tab Hoy**: verifica registros de compañeros (no el propio)
3. **Tab Mes**: fondo acumulado y cláusula de excelencia
4. **Tab Deudas**: registra pagos y abonos
5. **Tab Historial**: exporta CSV
6. **Tab Admin**: gestiona colaboradores y configura el Worker

---

## Política SLA

| Severidad | Retraso | Castigo |
|-----------|---------|---------|
| A tiempo | hasta 08:02 | L0 |
| Sev 3 | 08:03 – 08:05 | L1 × min |
| Sev 2 | 08:06 – 08:15 | L10 + L1 × min |
| Sev 1 | 08:16+ | L1 × min + ☕ café al equipo |

**Gamificación:**
- L300 → Desayuno
- L600 → Pizza Day
- L1000 → Almuerzo patrocinado

**Cláusula de Excelencia:** Si nadie tiene incidentes verificados en el mes completo → premio activo.

## Fuerza Mayor

Los siguientes eventos no generan castigo:
- Fallas de transporte
- Emergencias familiares
- Actividades técnicas autorizadas
- Desastres naturales

> Deben ser marcados en el momento del registro e indicar el motivo.

---
*v1.0 — Uso interno · Departamento TI · jorge-kirkconell/latencia-matutina*
