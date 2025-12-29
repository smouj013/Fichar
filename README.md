# ClockIn — Aplicación de fichaje (PWA)

ClockIn es una PWA para registrar fichajes de **múltiples empleados** en una vista general: nombre + botones de **Entrada/Salida** y **Pausa**, mostrando en la misma fila la hora de entrada/salida, pausa y tiempo trabajado.

## Funciones principales
- ✅ Vista general con todos los empleados (scroll perfecto).
- ✅ Horario semanal por empleado (activar días + horas + pausa).
- ✅ Fichajes: Entrada, Pausa (inicio/fin), Salida.
- ✅ Notas opcionales por evento.
- ✅ Resumen diario por empleado.
- ✅ Historial con filtros (empleado + rango de fechas).
- ✅ Export CSV (resumen y eventos).
- ✅ PIN opcional (PBKDF2 SHA-256) para proteger exportaciones y borrado.
- ✅ Ubicación opcional (3 decimales) si activas geolocalización.
- ✅ PWA offline (Service Worker) e instalable.

## Estructura
- index.html
- styles.css
- app.js
- sw.js
- manifest.webmanifest
- assets/icons/ (iconos del proyecto)
- LICENSE

## Ejecutar en local
Necesitas servirlo por HTTP para que funcione el Service Worker:

```bash
python -m http.server 8080
