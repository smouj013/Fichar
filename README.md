# ClockIn — PWA de fichaje (v2.0.0)

ClockIn es una PWA ligera para registrar fichajes de múltiples empleados en una vista general:
Entrada/Salida + Pausas, con resumen por día, historial con filtros, export CSV, PIN opcional y modo offline.

## ✅ Características
- Vista general con empleados (scroll perfecto).
- Fichajes: Entrada, Pausa (inicio/fin), Salida.
- Notas opcionales por evento (configurable).
- Resumen por fecha (cambia día con selector / prev-next).
- Historial con filtros + paginado (no congela).
- Export CSV: resumen y eventos.
- Backup/Restore JSON.
- PIN opcional (PBKDF2 SHA-256) para proteger acciones sensibles.
- Geolocalización opcional (3 decimales).
- PWA instalable + offline (Service Worker).
- Auto-update estable (sin bucles) + modo Repair.

## 📦 Estructura
/
- index.html
- styles.css
- app.js
- sw.js
- manifest.webmanifest
- LICENSE
- assets/
  - icons/
    - favicon-32.png
    - apple-touch-icon-152.png
    - apple-touch-icon-167.png
    - apple-touch-icon-180.png
    - icon-192.png
    - icon-512.png
    - icon-192-maskable.png
    - icon-512-maskable.png

> Nota: en GitHub Pages las rutas son sensibles a mayúsculas/minúsculas. Respeta los nombres.

## ▶️ Ejecutar en local
Necesitas servirlo por HTTP/HTTPS (no vale abrir index.html como archivo).

**Python**
```bash
python -m http.server 8080
