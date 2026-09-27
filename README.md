# Bazar Colibrí

Sitio web publicitario del Bazar Colibrí: HTML + CSS + JavaScript sin frameworks ni build.
El colibrí 3D usa la ilustración del logo separada en capas (ala, cuerpo, cola, aura) y montada en 3D con
[Three.js](https://threejs.org/) (cargado desde jsDelivr).

## Estructura

```
index.html                 Contenido de todas las secciones
assets/css/styles.css      Estilos (paleta en :root)
assets/js/config.js        Datos de contacto (WhatsApp, Instagram, correo)
assets/js/main.js          Menú, filtros, tarjetas 3D, formulario
assets/js/hummingbird.js   Colibrí 3D que acompaña el scroll
assets/img/                Logo y favicon
assets/img/bird/           Capas del colibrí 3D (generadas desde el logo)
tools/split_logo.py        Script que corta el logo en esas capas
```

## Cómo editar

- **Contacto:** completa `assets/js/config.js`. Mientras un canal esté vacío, su botón muestra "muy pronto".
- **Productos, participantes, fechas:** en `index.html`, bloques marcados con `<!-- EDITAR -->`.
- **Recorrido del colibrí:** cada `<section>` tiene `data-bird="x,y,escala,dirección"`
  (x/y de -0.5 a 0.5 respecto de la pantalla; dirección 1 = mira a la derecha, -1 = izquierda)
  y `data-bird-mobile` para pantallas angostas.

## Regenerar el colibrí desde el logo

```
pip install pillow numpy opencv-python-headless
python3 tools/split_logo.py ruta/al/logo.jpg assets/img/bird
```
Los polígonos de cada parte (ala, cuerpo, cola) están al inicio del script, en píxeles del logo de 1024×1024.

## Ver en local

```
python3 -m http.server 8000
```
y abre http://localhost:8000 (hace falta un servidor: los módulos JS no cargan con `file://`).
