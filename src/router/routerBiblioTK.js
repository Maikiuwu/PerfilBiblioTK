import { Router } from "express";
import {
  actualizarPerfil,
  eliminarPerfil,
  obtenerPerfil,
} from "../controllers/perfilController.js";
import { verificarSesion } from "../middlewares/verificarSesion.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ message: "Servicio de perfil activo" });
});

router.get("/Perfil", verificarSesion, obtenerPerfil);
router.put("/Perfil", verificarSesion, actualizarPerfil);
router.delete("/Perfil", verificarSesion, eliminarPerfil);

export default router;
