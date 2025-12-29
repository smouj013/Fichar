# ClockIn — PWA de fichaje (v1.0.0)

ClockIn es una PWA ligera para registrar el fichaje de múltiples empleados en una vista general. Permite marcar Entrada/Salida y Pausa por empleado, con resumen diario, historial con filtros, exportación CSV, copia de seguridad, PIN opcional y modo offline.

Diseño pensado para funcionar bien en móvil y escritorio, con scroll fluido y UI clara.

---

## Funciones principales

- Vista general con todos los empleados en la misma pantalla (scroll perfecto).
- Horario semanal por empleado (días laborables + horas + días libres).
- Fichajes: Entrada, Pausa (inicio/fin), Salida.
- Notas opcionales por evento.
- Resumen diario por empleado (pausa, trabajado, estado).
- Historial con filtros: empleado + rango de fechas.
- Exportación CSV: resumen diario y eventos.
- PIN opcional (PBKDF2 SHA-256) para proteger exportaciones/importaciones y borrados.
- Ubicación opcional (lat/lon redondeadas a 3 decimales) si se activa geolocalización.
- PWA instalable + modo offline (Service Worker).
- Modo Repair para limpiar caché/SW si una actualización se queda atascada.

---

## Estructura del proyecto

/  
|-- index.html  
|-- styles.css  
|-- app.js  
|-- sw.js  
|-- manifest.webmanifest  
|-- .nojekyll  
|-- LICENSE  
`-- assets/  
    `-- icons/  
        |-- favicon-32.png  
        |-- apple-touch-icon-152.png  
        |-- apple-touch-icon-167.png  
        |-- apple-touch-icon-180.png  
        |-- icon-192.png  
        |-- icon-512.png  
        |-- icon-192-maskable.png  
        `-- icon-512-maskable.png  

---

## Ejecutar en local

Para que el Service Worker funcione, necesitas servirlo por HTTP/HTTPS (no vale abrir el HTML como archivo).

Opción A — Python:
python -m http.server 8080  
Abrir: http://localhost:8080/

Opción B — Node (http-server):
npx http-server -p 8080

---

## Instalar como app (PWA)

En móvil/desktop compatible:
- Abre la web
- Menú del navegador → Instalar aplicación / Añadir a pantalla de inicio

ClockIn funciona en modo standalone y guarda datos localmente.

---

## Uso rápido

Panel (Empleados de hoy): cada empleado muestra estado, horario, pausa acumulada y tiempo trabajado acumulado.

Acciones:
- Entrada: inicia la jornada
- Pausa: inicia el descanso
- Fin pausa: termina el descanso
- Salida: finaliza la jornada (si estás en pausa, primero debes finalizarla)

Cada acción puede incluir una nota opcional.

---

## Horarios semanales

En Ajustes → Empleados:
- Crear/editar empleados
- Configurar horario por día: inicio (HH:MM), fin (HH:MM), día libre (OFF)

El horario se usa para mostrar el horario en Panel/Resumen.

---

## Resumen diario

En Resumen se genera una tabla con: Entrada/Salida, Pausa total, Trabajado total y Estado del día.

Se puede exportar como CSV.

---

## Historial y filtros

En Historial puedes filtrar:
- Empleado (Todos o uno)
- Desde / Hasta (rango de fechas)

Por rendimiento, el historial carga por páginas:
- Por defecto muestra 300 eventos
- Botón “Cargar más” para ampliar sin congelar la UI

Exporta eventos filtrados a CSV.

---

## Seguridad (PIN opcional)

Puedes activar un PIN en Ajustes → Seguridad.

- Se almacena como PBKDF2 SHA-256 (hash derivado + salt)
- Protege acciones sensibles: exportar CSV, exportar/importar copia JSON y borrar datos/empleados

Nota: PBKDF2 requiere crypto.subtle, que funciona correctamente en HTTPS o localhost.

---

## Geolocalización (opcional)

Si activas Geolocalización:
- Al fichar, se guarda una ubicación aproximada (3 decimales) si el dispositivo lo permite.
- Si el permiso se deniega, el fichaje se guarda igualmente sin ubicación.

---

## Copias de seguridad (JSON)

En Ajustes → Datos:
- Exportar copia (JSON): descarga un backup completo (empleados + horarios + eventos).
- Importar copia (JSON): reemplaza los datos actuales por el backup.

---

## Modo Repair (soluciona cachés/SW atascados)

Si una actualización se queda pillada (o la app no refresca):
1) Abre la app con: /?repair  
2) Acepta el borrado de Service Worker + cachés  
3) Recarga con Ctrl+F5

Ejemplo:
https://tu-dominio/ClockIn/?repair

---

## Publicar en GitHub Pages

1) Sube los archivos al repo (rama main)
2) Settings → Pages
3) Source: Deploy from a branch
4) Branch: main / root
5) Espera a que te genere la URL de Pages

Recomendado: mantener .nojekyll para evitar problemas de rutas y assets.

---

## Licencia

Revisa el archivo LICENSE en la raíz del proyecto.

---

## Compatibilidad

- Funciona en navegadores modernos (Chrome/Edge/Firefox/Safari reciente)
- PWA + offline mediante Service Worker
- Datos guardados en localStorage (local al dispositivo)

---

## Solución de problemas

La app no carga / pantalla en blanco:
- Prueba /?repair
- Abre consola (F12) y revisa errores

El PIN no funciona:
- Asegúrate de estar en https:// o http://localhost

No se guarda la ubicación:
- Revisa permisos de ubicación del navegador/dispositivo

---

## Versión

v1.0.0
