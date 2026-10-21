# PerfilBiblioTK — Servicio de perfil

Parte del sistema BiblioTK (ver `../CLAUDE.md`). Permite al usuario con sesión consultar, editar y eliminar sus propios datos de la tabla `usuarios`.

- **Puerto:** 3002 (`PORT` en `.env`). Ojo: el `.env` de BackDashboardBiblioTK también usa 3002.
- **Arranque:** `npm run dev` (`node --watch src/app.js`). Solo levanta el servidor si `testConnection()` (un `SELECT 1`) funciona.
- **Docker:** `Dockerfile` (node:24-alpine, solo dependencias de producción, usuario `node`, sin `.env`: la configuración llega por variables de entorno). Se orquesta desde `../InfraBiblioTK` (Compose y Kubernetes).
- **Dependencias clave:** express 5, mysql2, cookie-parser, bcrypt, cors y dotenv (versiones fijas, sin `^`). `jsonwebtoken` sigue en `package.json`, pero ya no se usa.
- **Variables (`.env`):** `PORT=3002`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` y `ALLOWED_ORIGIN_*` (orígenes de CORS, uno por variable). `JWT_SECRET` ya no hace falta: este servicio no emite sesiones, solo busca la de la cookie `token_acceso` en la tabla `sesiones` (la crea InicioSesionBiblioTK). Opcionales: `NOTIFICACIONES_URL` (por defecto `http://localhost:3006/NotificacionesBiblioTK`) y `NOTIFICACIONES_CLAVE`.

## Estructura

- `src/app.js` — express + `cookieParser()` + CORS con `credentials: true` (GET, PUT y DELETE) + router en `/PerfilBiblioTK` + middleware de errores: JSON mal formado → 400; cualquier otro error → 500 con un mensaje genérico (el detalle solo sale por consola)
- `src/config/db.js` — pool mysql2 y `testConnection()` real
- `src/middlewares/verificarSesion.js` — lee la cookie `token_acceso` (un valor aleatorio), busca su hash SHA-256 en `sesiones` (sin vencer) y deja `req.sesion = { id, email, rol }` con los datos actuales de `usuarios`. Sin cookie, con una sesión cerrada o vencida → 401. Pone `Cache-Control: no-store` en todas las respuestas con sesión (es el mismo archivo en Materiales y Préstamos)
- `src/router/routerBiblioTK.js`
- `src/controllers/perfilController.js` — `obtenerPerfil`, `actualizarPerfil`, `eliminarPerfil`
- `src/utils/notificar.js` — `notificar(tipo, datos)`: avisa a NotificacionesBiblioTK después de cada cambio, sin esperar respuesta (si no está, solo queda en la consola). Emite `perfil.actualizado` (lo ven el superadmin y el dueño) y `usuario.eliminado` (el superadmin)

La cookie la emite `localhost:3001`, pero también llega a `:3003`: las cookies no distinguen puertos.

## Endpoints

| Método | Ruta | Controlador | Respuesta |
|---|---|---|---|
| GET | `/PerfilBiblioTK/health` | inline | `{ message }` |
| GET | `/PerfilBiblioTK/Perfil` | `obtenerPerfil` | `{ perfil: { id, nombres, apellidos, email, cc, celular, nombreUsuario, rol, fechaRegistro } }` (nunca `password`) |
| PUT | `/PerfilBiblioTK/Perfil` | `actualizarPerfil` | Body `{ nombres, apellidos, email, celular, nombreUsuario }` → `{ message, perfil }` (la cédula no se cambia: si llega `cc`, se ignora) |
| DELETE | `/PerfilBiblioTK/Perfil` | `eliminarPerfil` | Body `{ contrasena }` → `{ message }` y borra la cookie |

Todas las rutas `/Perfil` pasan por `verificarSesion` y actúan solo sobre `req.sesion.id` (el dueño de la sesión). Los errores de datos responden `{ campo, message }` para que el front marque el campo. La usan `BiblioTK-front-user` y `BiblioTK-front-admin` (`src/service/ProfileService.js`, página `/perfil` en ambas).

### PUT /Perfil

1. Normaliza (recorta espacios y pasa el correo a minúsculas) y valida con las mismas reglas que el registro del front, más el largo máximo de cada columna → **400** `{ campo, message }`.
2. Si otra cuenta ya usa ese `email` o `nombreusuario` → **409** `{ campo, message }`.
3. `UPDATE` (sin `cc`: la cédula identifica a la persona y no se edita desde el perfil) → **200** con el perfil actualizado.

### DELETE /Perfil

1. Sin `contrasena` → **400**.
2. Si el rol guardado en la BD es `superadmin` → **403**. Lectores (`usuario`) y bibliotecarios (`admin`) sí pueden borrar su cuenta.
3. Contraseña incorrecta (bcrypt) → **403** `{ campo: "contrasena" }`.
4. Con préstamos `ACTIVO` o `VENCIDO`, o solicitudes `SOLICITADO` → **409** (una solicitud borrada en cascada dejaría su material apartado para siempre).
5. Si es `admin` y no queda ningún otro `admin` → **409**: sin bibliotecario nadie podría administrar el catálogo.
6. En una transacción: deja en NULL los datos personales de sus filas en `reportes` (el historial de préstamos queda anónimo; si la tabla todavía no existe, se ignora) y `DELETE FROM usuarios` (sus filas de `sesiones` se borran en cascada). Luego `clearCookie("token_acceso")` → **200**.

## Problemas conocidos

- `prestamos.usuario_id` tiene `ON DELETE CASCADE`: al borrar una cuenta también se borran sus préstamos `DEVUELTO` (los pendientes bloquean el borrado); su copia en `reportes` se conserva, sin datos personales.
- La tabla `usuarios` no tiene índices `UNIQUE`: la unicidad se comprueba en código, así que dos peticiones simultáneas podrían colarse.
- Hay cuentas antiguas con datos que no cumplen la validación (por ejemplo, correos sin dominio): para guardar cualquier cambio primero deben corregirlos.
- Si cambia el correo, la cabecera del front muestra el anterior hasta recargar la página (`/Sesion` ya devuelve el correo actual).
- Todavía no hay cambio de contraseña.
- Es un repositorio git nuevo, todavía sin commits ni remoto.
