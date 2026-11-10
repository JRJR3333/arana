# Vivible Madrid — cómo se actualiza

Proyecto aparte de la araña (proyecto «Ganar Dinero» de Juan). Web: https://jrjr3333.github.io/arana/vivible/

- `template.html`: la página, con `__DATA__` donde van los datos.
- `data.json`: barrios (polígonos simplificados y distrito) y estaciones de metro y metro ligero. Se genera con `prep.py` desde el geojson de barrios (Code for Germany, `click_that_hood`) y el CSV de paradas del CRTM.
- Montar la página: `python3 -c "t=open('template.html').read();open('../index.html','w').write(t.replace('__DATA__',open('data.json').read()))"`.
- Precios: objeto `PRICE` de `template.html` (idealista, €/m² de venta y alquiler por distrito). Actualizar cada mes y cambiar el mes en el pie.
