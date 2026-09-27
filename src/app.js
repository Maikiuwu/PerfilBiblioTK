import cookieParser from "cookie-parser";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { testConnection } from "./config/db.js";
import routerBiblioTK from "./router/routerBiblioTK.js";

const app = express();
const puerto = Number(process.env.PORT) || 3002;

app.use(express.json());
app.use(cookieParser());

const allowedOrigins = Object.entries(process.env)
  .filter(([key, value]) => key.startsWith('ALLOWED_ORIGIN_') && value)
  .map(([, origin]) => origin.trim());

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);;

app.use("/PerfilBiblioTK", routerBiblioTK);

// Los detalles del error se quedan en la consola: al cliente solo le llega un mensaje genérico
app.use((error, _req, res, _next) => {
  if (error.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({ message: "El cuerpo de la solicitud no es un JSON válido" });
  }

  console.error("Error del servidor:", error);
  return res.status(500).json({ message: "Error interno del servidor" });
});

async function iniciarServidor() {
  try {
    await testConnection();
    app.listen(puerto, () => {
      console.log(`Servicio de perfil corriendo en el puerto ${puerto}`);
    });
  } catch {
    process.exitCode = 1;
  }
}

iniciarServidor();
