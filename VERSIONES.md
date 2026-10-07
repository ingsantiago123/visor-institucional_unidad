# Versiones publicadas de este visor

Este sitio de GitHub Pages lo usan **todos** los cursos que apuntan a el desde Moodle
(local_visorincca: ajustes `visor_url` / `visor_unidad_url` o un diseño del catalogo).
Un cambio aqui llega a todos esos cursos a la vez, por eso cada version vive en su
propia carpeta y Moodle apunta a una carpeta fija.

| Carpeta | Que es |
|---|---|
| `/v1/` | Copia exacta del visor que estaba en produccion el 2026-10-07 (repos *_prueba_piloto). |
| `/v2/` | Version 2.0.0: sin contenido de ejemplo en cursos reales, videos bajo demanda, animaciones en pausa fuera de pantalla, texto escapado, puente postMessage v2 (compatible con el plugin 4.22). |
| raiz `/` | Igual a v1, solo por compatibilidad. No apuntar Moodle aqui. |

## Reglas

1. Una carpeta publicada **nunca se edita**. Cualquier arreglo va en una carpeta nueva (`/v3/`...).
2. Probar primero en 1 o 2 cursos con un diseño del catalogo (Administracion > Visor U.INCCA > Diseños)
   y recien despues cambiar el ajuste global.
3. Volver atras = poner otra vez la carpeta anterior en el ajuste o en el diseño.
