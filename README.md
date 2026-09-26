# Bazar Colibrí

Sitio web publicitario del Bazar Colibrí: HTML + CSS + JavaScript sin frameworks ni build.
El colibrí 3D se construye en código con [Three.js](https://threejs.org/) (cargado desde jsDelivr).

## Estructura

```
index.html                 Contenido de todas las secciones
assets/css/styles.css      Estilos (paleta en :root)
assets/js/config.js        Datos de contacto (WhatsApp, Instagram, correo)
assets/js/main.js          Menú, filtros, tarjetas 3D, formulario
assets/js/hummingbird.js   Colibrí 3D que acompaña el scroll
assets/img/                Logo y favicon
```

## Cómo editar

- **Contacto:** completa `assets/js/config.js`. Mientras un canal esté vacío, su botón muestra "muy pronto".
- **Productos, participantes, fechas:** en `index.html`, bloques marcados con `<!-- EDITAR -->`.
- **Recorrido del colibrí:** cada `<section>` tiene `data-bird="x,y,escala,dirección"`
  (x/y de -0.5 a 0.5 respecto de la pantalla; dirección 1 = mira a la derecha, -1 = izquierda)
  y `data-bird-mobile` para pantallas angostas.

## Ver en local

```
python3 -m http.server 8000
```
y abre http://localhost:8000 (hace falta un servidor: los módulos JS no cargan con `file://`).
