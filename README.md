# ClockIn - Aplicación de fichaje

Este proyecto es una aplicación web progresiva (PWA) para controlar la entrada y salida en el trabajo. Permite fichar las horas de inicio, pausas, regreso y salida, así como añadir notas opcionales. La aplicación calcula automáticamente los tiempos de trabajo y pausa, muestra un resumen diario y permite exportar los datos a CSV.

## Características

- **Fichar**: registra eventos de entrada, inicio de pausa, fin de pausa y salida.
- **Notas**: añade notas a los eventos (p. ej., “médico”, “reunión”).
- **Resumen por día**: visualiza el total de horas trabajadas y pausadas para cada día.
- **Historial detallado**: muestra la lista de eventos cronológicos con su hash de integridad.
- **Exportar**: exporta el resumen de horas o el historial completo a CSV.
- **PIN opcional**: protege la exportación y el borrado con un PIN (cifrado con PBKDF2).
- **PWA offline**: funciona sin conexión gracias al Service Worker y es instalable en el dispositivo.
- **Ubicación opcional**: guarda las coordenadas aproximadas al fichar (3 decimales) si se activa.

## Estructura del proyecto

- **index.html** – Marcado HTML de la aplicación.
- **styles.css** – Estilos CSS, incluyendo un tema oscuro por defecto.
- **app.js** – Lógica de la aplicación: estado, eventos, cálculo de tiempos, UI y exportación.
- **sw.js** – Service Worker para cachear archivos y permitir funcionamiento offline.
- **manifest.webmanifest** – Archivo de manifiesto PWA.
- **README.md** – Documentación básica del proyecto.

## Instalación y ejecución

Para ejecutar la aplicación localmente y que el Service Worker funcione correctamente, debes servir la carpeta mediante un servidor HTTP. Por ejemplo, desde la raíz del proyecto ejecuta:

```bash
python -m http.server 8080
```

o, si tienes Node.js instalado:

```bash
npx http-server -p 8080
```

Luego abre en tu navegador: `http://localhost:8080`.

## Autor

Esta aplicación fue desarrollada por **Smouj013** como ejemplo de una pequeña herramienta de fichaje. Puedes usarla, modificarla y adaptarla a tus necesidades personales.