# PerfilBiblioTK — Servicio de perfil

Parte del sistema BiblioTK (ver `../CLAUDE.md`). Permite al usuario con sesión consultar, editar y eliminar sus propios datos de la tabla `usuarios`.

- **Puerto:** 3003 (`PORT` en `.env`)
- **Arranque:** `npm run dev` (`node --watch src/app.js`). Solo levanta el servidor si `testConnection()` (un `SELECT 1`) funciona.
- **Dependencias clave:** express 5, mysql2, cookie-parser, jsonwebtoken, bcrypt, cors y dotenv (versiones fijas, sin `^`)
- **Variables (`.env`):** `PORT=3003`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT` y `JWT_SECRET`. **`JWT_SECRET` debe ser el mismo de InicioSesionBiblioTK**: este servicio no emite tokens, solo verifica la cookie `token_acceso`.

## Estructura

- `src/app.js` — express + `cookieParser()` + CORS con `credentials: true` (GET, PUT y DELETE) + router en `/PerfilBiblioTK` + middleware de errores: JSON mal formado → 400; cualquier otro error → 500 con un mensaje genérico (el detalle solo sale por consola)
- `src/config/db.js` — pool mysql2 y `testConnection()` real
- `src/middlewares/verificarSesion.js` — lee la cookie `token_acceso`, la verifica con `JWT_SECRET` y deja `req.sesion = { id, email, rol }`. Sin cookie o con un token no válido → 401
- `src/router/routerBiblioTK.js`
- `src/controllers/perfilController.js` — `obtenerPerfil`, `actualizarPerfil`, `eliminarPerfil`

La cookie la emite `localhost:3001`, pero también llega a `:3003`: las cookies no distinguen puertos.

## Endpoints

| Método | Ruta | Controlador | Respuesta |
|---|---|---|---|
| GET | `/PerfilBiblioTK/health` | inline | `{ message }` |
| GET | `/PerfilBiblioTK/Perfil` | `obtenerPerfil` | `{ perfil: { id, nombres, apellidos, email, cc, celular, nombreUsuario, rol, fechaRegistro } }` (nunca `password`) |
| PUT | `/PerfilBiblioTK/Perfil` | `actualizarPerfil` | Body `{ nombres, apellidos, email, cc, celular, nombreUsuario }` → `{ message, perfil }` |
| DELETE | `/PerfilBiblioTK/Perfil` | `eliminarPerfil` | Body `{ contrasena }` → `{ message }` y borra la cookie |

Todas las rutas `/Perfil` pasan por `verificarSesion` y actúan solo sobre `req.sesion.id` (el `sub` del JWT). Los errores de datos responden `{ campo, message }` para que el front marque el campo. La usa `FrontBiblioTK/src/service/ProfileService.js`.

### PUT /Perfil

1. Normaliza (recorta espacios y pasa el correo a minúsculas) y valida con las mismas reglas que el registro del front, más el largo máximo de cada columna → **400** `{ campo, message }`.
2. Si otra cuenta ya usa ese `email`, `cc` o `nombreusuario` → **409** `{ campo, message }`.
3. `UPDATE` → **200** con el perfil actualizado.

### DELETE /Perfil

1. Sin `contrasena` → **400**.
2. Si el rol guardado en la BD (no el del token) no es `usuario` → **403**: las cuentas de administración no se borran desde el perfil.
3. Contraseña incorrecta (bcrypt) → **403** `{ campo: "contrasena" }`.
4. Con préstamos `ACTIVO` o `VENCIDO` → **409**.
5. `DELETE FROM usuarios` + `clearCookie("token_acceso")` → **200**.

## Problemas conocidos

- `prestamos.usuario_id` tiene `ON DELETE CASCADE`: al borrar una cuenta también se borran sus préstamos `DEVUELTO` (los pendientes bloquean el borrado).
- La tabla `usuarios` no tiene índices `UNIQUE`: la unicidad se comprueba en código, así que dos peticiones simultáneas podrían colarse.
- Hay cuentas antiguas con datos que no cumplen la validación (por ejemplo, correos sin dominio): para guardar cualquier cambio primero deben corregirlos.
- El JWT no se renueva al editar: si cambia el correo, la cabecera del front muestra el anterior hasta el siguiente inicio de sesión.
- Todavía no hay cambio de contraseña.
- Es un repositorio git nuevo, todavía sin commits ni remoto.
