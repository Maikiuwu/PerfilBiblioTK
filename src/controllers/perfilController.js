import dns from "node:dns/promises";
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

async function domainCanReceiveEmail(email) {
	const domain = email.split("@")[1];

	try {
		const mxRecords = await dns.resolveMx(domain);
		return mxRecords.length > 0;
	} catch {
		// ENOTFOUND / ENODATA → el dominio no existe o no acepta correo
		return false;
	}
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
			message:
				"La cédula debe ser un número entero mayor que 0, de hasta 15 dígitos.",
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

		const dominioValido = await domainCanReceiveEmail(email);

		if (!dominioValido) {
			return res.status(400).json({
				field: "email",
				message:
					"El dominio de ese correo no existe o no puede recibir mensajes.",
			});
		}

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

			return res.status(409).json({ campo, message: mensajesDuplicado[campo] });
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

		// Se usa el rol guardado en la BD, no el del token, por si cambió después del login
		if (usuario.rol !== "usuario") {
			return res.status(403).json({
				message:
					"Las cuentas de administración no se pueden eliminar desde el perfil.",
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

		await pool.query("DELETE FROM usuarios WHERE id = ?", [req.sesion.id]);

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
