import bcrypt from "bcrypt";
import pool from "../config/db.js";

const columnasPerfil = `id, nombres, apellidos, email, cc, celular,
  nombreusuario AS nombreUsuario, rol, fecharegistro AS fechaRegistro`;

const letras = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
const patronNombre = new RegExp(`^[${letras}]+(?:[ '-][${letras}]+)*$`);
const patronEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const patronCedula = /^[1-9]\d*$/;
const patronCelular = /^\d{7,15}$/;

const mensajesDuplicado = {
  email: "Ese correo ya está registrado en otra cuenta.",
  cc: "Esa cédula ya está registrada en otra cuenta.",
  nombreUsuario: "Ese nombre de usuario ya está en uso.",
};

function comoTexto(valor) {
  return typeof valor === "string" || typeof valor === "number"
    ? String(valor).trim()
    : "";
}

function normalizarPerfil(datos = {}) {
  return {
    nombres: comoTexto(datos.nombres),
    apellidos: comoTexto(datos.apellidos),
    email: comoTexto(datos.email).toLowerCase(),
    cc: comoTexto(datos.cc),
    celular: comoTexto(datos.celular),
    nombreUsuario: comoTexto(datos.nombreUsuario),
  };
}

function esNombreValido(valor) {
  return valor.length >= 2 && valor.length <= 50 && patronNombre.test(valor);
}

// Mismas reglas que el formulario del front, más el largo máximo de cada columna
function validarPerfil(perfil) {
  if (!esNombreValido(perfil.nombres)) {
    return {
      campo: "nombres",
      message:
        "Los nombres deben tener entre 2 y 50 caracteres: letras, espacios, apóstrofes o guiones.",
    };
  }

  if (!esNombreValido(perfil.apellidos)) {
    return {
      campo: "apellidos",
      message:
        "Los apellidos deben tener entre 2 y 50 caracteres: letras, espacios, apóstrofes o guiones.",
    };
  }

  if (!patronCedula.test(perfil.cc) || perfil.cc.length > 15) {
    return {
      campo: "cc",
      message: "La cédula debe ser un número entero mayor que 0, de hasta 15 dígitos.",
    };
  }

  if (!patronEmail.test(perfil.email) || perfil.email.length > 100) {
    return {
      campo: "email",
      message: "Ingresa un correo válido, por ejemplo: tu@correo.com.",
    };
  }

  if (!patronCelular.test(perfil.celular)) {
    return {
      campo: "celular",
      message: "El celular debe contener solo números, entre 7 y 15 dígitos.",
    };
  }

  if (!perfil.nombreUsuario || perfil.nombreUsuario.length > 30) {
    return {
      campo: "nombreUsuario",
      message: "El nombre de usuario debe tener entre 1 y 30 caracteres.",
    };
  }

  return null;
}

function mismoTexto(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

const rolesQuePuedenBorrarse = ["usuario", "admin"];

// La tabla reportes (de PrestamosBiblioTK) conserva el historial de préstamos aunque se
// borre la cuenta: antes de borrarla se le quitan los datos personales, en la misma transacción
async function borrarCuenta(usuarioId) {
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    try {
      await conexion.query(
        `UPDATE reportes
         SET usuario_id = NULL, usuario_nombre = NULL, usuario_email = NULL,
             usuario_cc = NULL, usuario_celular = NULL
         WHERE usuario_id = ?`,
        [usuarioId],
      );
    } catch (error) {
      // Si PrestamosBiblioTK todavía no creó la tabla, no hay nada que anonimizar
      if (error.code !== "ER_NO_SUCH_TABLE") throw error;
    }

    await conexion.query("DELETE FROM usuarios WHERE id = ?", [usuarioId]);
    await conexion.commit();
  } catch (error) {
    await conexion.rollback().catch(() => undefined);
    throw error;
  } finally {
    conexion.release();
  }
}

async function buscarPerfil(id) {
  const [filas] = await pool.query(
    `SELECT ${columnasPerfil} FROM usuarios WHERE id = ? LIMIT 1`,
    [id],
  );
  return filas[0] ?? null;
}

export async function obtenerPerfil(req, res, next) {
  try {
    const perfil = await buscarPerfil(req.sesion.id);

    if (!perfil) {
      return res.status(404).json({ message: "No se encontró el perfil" });
    }

    return res.json({ perfil });
  } catch (error) {
    return next(error);
  }
}

export async function actualizarPerfil(req, res, next) {
  try {
    const perfil = normalizarPerfil(req.body);
    const errorValidacion = validarPerfil(perfil);

    if (errorValidacion) {
      return res.status(400).json(errorValidacion);
    }

    // La tabla no tiene índices UNIQUE: la unicidad se comprueba aquí, igual que en el registro
    const [duplicados] = await pool.query(
      `SELECT email, cc, nombreusuario FROM usuarios
       WHERE id <> ? AND (email = ? OR cc = ? OR nombreusuario = ?)
       LIMIT 1`,
      [req.sesion.id, perfil.email, perfil.cc, perfil.nombreUsuario],
    );

    if (duplicados.length) {
      const [existente] = duplicados;
      const campo = mismoTexto(existente.email, perfil.email)
        ? "email"
        : mismoTexto(existente.cc, perfil.cc)
          ? "cc"
          : "nombreUsuario";

      return res
        .status(409)
        .json({ campo, message: mensajesDuplicado[campo] });
    }

    const [resultado] = await pool.query(
      `UPDATE usuarios
       SET nombres = ?, apellidos = ?, email = ?, cc = ?, celular = ?, nombreusuario = ?
       WHERE id = ?`,
      [
        perfil.nombres,
        perfil.apellidos,
        perfil.email,
        perfil.cc,
        perfil.celular,
        perfil.nombreUsuario,
        req.sesion.id,
      ],
    );

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ message: "No se encontró el perfil" });
    }

    return res.json({
      message: "Perfil actualizado",
      perfil: await buscarPerfil(req.sesion.id),
    });
  } catch (error) {
    return next(error);
  }
}

export async function eliminarPerfil(req, res, next) {
  try {
    const contrasena =
      typeof req.body?.contrasena === "string" ? req.body.contrasena : "";

    if (!contrasena) {
      return res.status(400).json({
        campo: "contrasena",
        message: "Escribe tu contraseña para confirmar.",
      });
    }

    const [filas] = await pool.query(
      "SELECT password, rol FROM usuarios WHERE id = ? LIMIT 1",
      [req.sesion.id],
    );
    const usuario = filas[0];

    if (!usuario) {
      return res.status(404).json({ message: "No se encontró el perfil" });
    }

    // Se usa el rol guardado en la BD, no el del token, por si cambió después del login.
    // Lectores y bibliotecarios pueden borrar su cuenta; el superadministrador no
    if (!rolesQuePuedenBorrarse.includes(usuario.rol)) {
      return res.status(403).json({
        message:
          "Las cuentas de superadministrador no se pueden eliminar desde el perfil.",
      });
    }

    const coincide = await bcrypt.compare(contrasena, usuario.password);

    if (!coincide) {
      return res.status(403).json({
        campo: "contrasena",
        message: "La contraseña no es correcta.",
      });
    }

    // prestamos.usuario_id tiene ON DELETE CASCADE: sin este control se perderían préstamos sin devolver
    const [[{ pendientes }]] = await pool.query(
      `SELECT COUNT(*) AS pendientes FROM prestamos
       WHERE usuario_id = ? AND estado IN ('ACTIVO', 'VENCIDO')`,
      [req.sesion.id],
    );

    if (Number(pendientes) > 0) {
      return res.status(409).json({
        message:
          "No puedes eliminar tu cuenta mientras tengas préstamos sin devolver.",
      });
    }

    // Sin ningún bibliotecario nadie podría administrar el catálogo ni los préstamos
    if (usuario.rol === "admin") {
      const [[{ otros }]] = await pool.query(
        "SELECT COUNT(*) AS otros FROM usuarios WHERE rol = 'admin' AND id <> ?",
        [req.sesion.id],
      );

      if (Number(otros) === 0) {
        return res.status(409).json({
          message:
            "No puedes eliminar la única cuenta de bibliotecario: primero debe existir otra.",
        });
      }
    }

    await borrarCuenta(req.sesion.id);

    res.clearCookie("token_acceso", {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    });

    return res.json({ message: "Cuenta eliminada" });
  } catch (error) {
    return next(error);
  }
}
