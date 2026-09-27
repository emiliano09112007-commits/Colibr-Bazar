"""Separa el logo de Bazar Colibrí en capas para el colibrí 3D.

Uso:  python3 tools/split_logo.py <logo.jpg> assets/img/bird
Genera WebP transparentes (ala, cuerpo, cola, aura) y bird.json con la
posición de cada capa en coordenadas del logo original (1024x1024).
Requiere: pillow, numpy, opencv-python-headless.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

SRC, OUT = sys.argv[1], Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

rgb = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
H, W = rgb.shape[:2]

# --- Quitar el fondo blanco: alfa según la distancia al blanco y "des-mezcla"
mn = rgb.min(axis=2)
alpha = 255 - mn
safe = np.maximum(alpha, 1)[..., None]
color = np.clip((rgb - mn[..., None]) * 255 / safe, 0, 255)
alpha[alpha < 10] = 0

# Lightness para separar trazos intensos de las manchas de acuarela
light = (rgb.max(axis=2) + rgb.min(axis=2)) / 2


def poly_mask(points, blur=3):
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).polygon(points, fill=255)
    m = np.asarray(m).astype(np.float32)
    if blur:
        m = cv2.GaussianBlur(m, (0, 0), blur)
    return m / 255


# Texto "Colibrí Bazar" (se excluye de todas las capas)
text = np.zeros((H, W), np.float32)
text[70:258, 520:945] = 1

WING = [(365, 124), (425, 146), (500, 212), (548, 272), (585, 330), (618, 385), (648, 430),
        (662, 470), (660, 525), (640, 572), (605, 612), (545, 622), (470, 612), (385, 585),
        (300, 555), (250, 525), (212, 472), (210, 398), (258, 383), (322, 336), (330, 282),
        (322, 232), (330, 180), (348, 142)]
BODY = [(1010, 224), (905, 262), (832, 312), (806, 334), (776, 322), (738, 322), (705, 338),
        (684, 368), (670, 410), (655, 452), (636, 500), (612, 560), (575, 600), (528, 618),
        (505, 652), (530, 700), (585, 672), (640, 628), (700, 588), (748, 540), (782, 482),
        (795, 425), (800, 380), (812, 350), (840, 330), (1012, 234)]
TAIL = [(612, 600), (606, 680), (575, 740), (520, 795), (455, 840), (360, 872), (230, 872),
        (120, 858), (40, 800), (35, 725), (120, 728), (175, 690), (180, 600), (195, 545),
        (300, 545), (420, 610), (520, 640), (575, 612)]

wing_m = poly_mask(WING) * (1 - text)
body_m = poly_mask(BODY) * (1 - text)
# Cola: solo trazos intensos (sin la acuarela amarilla/rosa/cian de fondo)
tail_m = poly_mask(TAIL) * (light < 175) * (1 - poly_mask(WING, 0)) * (1 - poly_mask(BODY, 0))
tail_m = cv2.GaussianBlur(tail_m.astype(np.float32), (0, 0), 0.8)


def save_layer(name, mask, rgb_img=None):
    a = (alpha * mask).clip(0, 255).astype(np.uint8)
    c = (color if rgb_img is None else rgb_img).astype(np.uint8)
    img = np.dstack([c, a])
    ys, xs = np.where(a > 8)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    pad = 4
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(W, x1 + pad), min(H, y1 + pad)
    out = Image.fromarray(img[y0:y1, x0:x1], 'RGBA')
    if name == 'aura':  # la acuarela es difusa: basta la mitad de resolución
        out = out.resize((out.width // 2, out.height // 2), Image.LANCZOS)
    out.save(OUT / f'{name}.webp', 'WEBP', quality=88, method=6)
    return {'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0)}


layers = {}
layers['wing'] = save_layer('wing', wing_m)
layers['tail'] = save_layer('tail', tail_m)

# Cuerpo: rellenar (inpaint) lo que el ala tapa, para que al aletear no quede
# un "fantasma" del ala ni un hueco.
hole = (poly_mask(WING, 0) * poly_mask(BODY, 0) > 0.5).astype(np.uint8) * 255
bgr = cv2.cvtColor(np.asarray(Image.open(SRC).convert('RGB')), cv2.COLOR_RGB2BGR)
filled = cv2.inpaint(bgr, hole, 18, cv2.INPAINT_TELEA)
filled_rgb = cv2.cvtColor(filled, cv2.COLOR_BGR2RGB).astype(np.float32)
# El relleno debe ser opaco dentro del cuerpo
fmn = filled_rgb.min(axis=2)
f_alpha = np.where(hole > 0, 255, 255 - fmn)
f_color = np.where(hole[..., None] > 0, filled_rgb,
                   np.clip((filled_rgb - fmn[..., None]) * 255 / np.maximum(255 - fmn, 1)[..., None], 0, 255))
saved_alpha = alpha.copy()
alpha = f_alpha.astype(np.float32)
layers['body'] = save_layer('body', body_m, f_color)
alpha = saved_alpha

# Aura: manchas de acuarela y salpicaduras (todo lo demás, sin texto)
used = np.clip(wing_m + body_m + tail_m, 0, 1)
aura_m = (1 - used) * (1 - text)
# Rellenar el hueco que dejan ala y cuerpo con un difuminado de la acuarela
# vecina (convolución normalizada), para que al aletear no se vea su silueta.
w = alpha * aura_m
k = 28
num_a = cv2.GaussianBlur(w, (0, 0), k)
den = cv2.GaussianBlur(aura_m.astype(np.float32), (0, 0), k) + 1e-3
num_c = np.dstack([cv2.GaussianBlur(color[..., i] * w, (0, 0), k) for i in range(3)])
fill_a = num_a / den
fill_c = num_c / np.maximum(num_a, 1e-3)[..., None]
inside = poly_mask(WING, 6) * (1 - text)
saved_alpha = alpha.copy()
alpha = alpha * aura_m + fill_a * inside * (1 - aura_m) * 0.9
aura_color = color * aura_m[..., None] + fill_c * (1 - aura_m[..., None])
layers['aura'] = save_layer('aura', np.ones_like(aura_m) * (1 - text), aura_color)
alpha = saved_alpha

meta = {
    'size': [W, H],
    'layers': layers,
    # Bisagra del ala (raíz) y eje de aleteo, en píxeles del logo
    'wingHinge': [600, 540],
    'wingAxis': [650 - 520, 430 - 600],
    'tailRoot': [590, 640],
    'center': [600, 500],
}
(OUT / 'bird.json').write_text(json.dumps(meta, indent=2))
print(json.dumps(layers))
