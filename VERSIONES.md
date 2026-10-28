# Versiones publicadas de este visor

Este sitio de GitHub Pages lo usan **todos** los cursos que apuntan a el desde Moodle
(local_visorincca: ajustes `visor_url` / `visor_unidad_url` o un diseño del catalogo).
Un cambio aqui llega a todos esos cursos a la vez, por eso cada version vive en su
propia carpeta y Moodle apunta a una carpeta fija.

| Carpeta | Que es |
|---|---|
| `/v1/` | Copia exacta del visor que estaba en produccion el 2026-10-07 (repos *_prueba_piloto). |
| `/v2/` | Version 2.0.1 (en piloto): sin contenido de ejemplo en cursos reales, videos bajo demanda, animaciones en pausa fuera de pantalla, texto escapado, puente postMessage v2 (compatible con el plugin 4.22). |
| `/v3/` | Version 3.2.1 (2026-10-26, ajuste global de Moodle; 3.2.1 capsula mas compacta en celulares angostos; 3.2.0 agrega el salto entre unidades: capsula Anterior/Siguiente en el inicio y tarjeta "Siguiente unidad" en la ultima diapositiva, con `navegacion` del plugin 4.28 y el mensaje `ir-unidad`; 3.1.1 reserva el canal de la barra de desplazamiento): mismo contrato JSON y mismo puente que v2, con el diseno del visor de curso v4 segun el sistema de diseno INCCA: un solo escenario (foto + velo + red de particulas en un Worker), diapositivas oscuras/claras, emblema de la unidad, paneles azules, play de vidrio, botones pildora, barra flotante y dialogos nativos (`assets/css/visor.css` = base compartida con el visor de curso, `assets/css/unidad.css` = diapositivas de la unidad). Lecturas de apoyo con el libro de v2 (tapa que gira sobre su lomo). Videos de Google Drive en celular o con menos de 300 px para el reproductor: se abren en Drive en vez de embeberse. Incluye el tipo `multimedia` de la plantilla nueva (plugin 4.25). Usar con el visor de recurso `/v4/`. |
| `/v4/` | Version 4.0.1 (2026-10-28, en piloto; 4.0.1 quita los paquetes zip: una experiencia es un enlace o un HTML pegado): v3 + protocolo de aulas de 4 semanas (plugin 4.31). Con `"protocolo": "4semanas"`: la semana se ordena por espacio (lectura, mapa, infografia, microcapsulas, complementario, experiencia, entrega/parcial), el inicio muestra la capa (Semana N · peso, proposito, tiempo estimado), las actividades con espacio propio (H5P, laboratorio, entrega, parcial) salen a una diapositiva completa con su portada HTML aislada y un boton directo, el tipo `experiencia` (enlace en iframe o HTML pegado en iframe con sandbox) y con pantalla completa, y la capa 6 cierra con agradecimiento y espacio para logos. Familias de color de los disenos nuevos: azul, blanca, cian (cuadrados que suben) y dorada (carbon y oro). Sin protocolo se ve igual que v3. Usar con el visor de recurso `/v5/`. |
| raiz `/` | Igual a v1, solo por compatibilidad. No apuntar Moodle aqui. |

## Reglas

1. Mientras una version esta en **piloto** (solo la usan los cursos del diseño "Piloto vN") se puede corregir, subiendo el `?v=` de su `index.html`.
   Desde que el ajuste global apunta a ella queda **congelada**: cualquier arreglo va en una carpeta nueva (`/v3/`...).
2. Probar primero en 1 o 2 cursos con un diseño del catalogo (Administracion > Visor U.INCCA > Diseños)
   y recien despues cambiar el ajuste global.
3. Volver atras = poner otra vez la carpeta anterior en el ajuste o en el diseño.
